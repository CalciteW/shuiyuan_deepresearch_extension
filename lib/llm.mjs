// lib/llm.mjs —— minimal multi-provider LLM chat client for the extension pages.
// The user brings their own key two wire formats are supported
//   - "openai"    POST baseUrl/chat/completions   OpenAI-compatible —— covers
//                  OpenAI DeepSeek Kimi/Moonshot   GLM ...
//   - "anthropic" POST baseUrl/v1/messages        Claude API
// Cross-origin fetch works because the LLM origin is granted as an optional
// host permission when the user saves settings.

export const PRESETS = 
  deepseek 
    label "DeepSeek"
    style "openai"
    baseUrl "https//api.deepseek.com/v1"
    model "deepseek-chat"

  kimi 
    label "Kimi Moonshot"
    style "openai"
    baseUrl "https//api.moonshot.cn/v1"
    model "moonshot-v1-8k"

  qwen 
    label " DashScope"
    style "openai"
    baseUrl "https//dashscope.aliyuncs.com/compatible-mode/v1"
    model "qwen-plus"

  glm 
    label " GLM"
    style "openai"
    baseUrl "https//open.bigmodel.cn/api/paas/v4"
    model "glm-4.5"

  openai 
    label "OpenAI"
    style "openai"
    baseUrl "https//api.openai.com/v1"
    model "gpt-4o-mini"

  anthropic 
    label "Anthropic Claude"
    style "anthropic"
    baseUrl "https//api.anthropic.com"
    model "claude-opus-5"

  custom 
    label " OpenAI "
    style "openai"
    baseUrl ""
    model ""



function trimSlashurl 
  return Stringurl  "".replace//+/ ""


export class LlmError extends Error 
  constructormessage  status = null body = null  =  
    supermessage
    this.name = "LlmError"
    this.status = status
    this.body = body



async function readErrorresponse 
  let body = ""
  try 
    body = await response.text
   catch 
    // ignore

  let detail = body.slice0 400
  try 
    const parsed = JSON.parsebody
    detail = parsed.error.message  parsed.message  detail
   catch 
    // not JSON

  return new LlmErrorLLM  HTTP response.status detail 
    status response.status
    body body.slice0 2000



/**
       * Multi-turn chat. messages = role "user""assistant" content string.
       * The conversation is append-only by design so provider prefix caching hits
       *   - Anthropic explicit cachecontrol breakpoints on the system prompt the
       *     big first user turn the research materials and the newest assistant
       *     turn —— earlier breakpoints remain valid read points so hits accrue as
       *     the follow-up conversation grows.
       *   - OpenAI-compatible providers DeepSeek/Kimi/Qwen/GLM/OpenAI cache
       *     identical prefixes automatically append-only history is all they need.
       * Returns the assistant message text.
       */
export async function chatTurncfg  system messages maxTokens = 4096 signal  =  
  const base = trimSlashcfg.baseUrl
  if base  cfg.apiKey  cfg.model 
    throw new LlmError"LLM ： Base URL / API Key / 。"


  if cfg.style === "anthropic" 
    const lastAssistant = messages.mapm = m.role.lastIndexOf"assistant"
    const body = messages.mapm i = 
            const block =  type "text" text m.content 
      if messages.length  1 && i === 0  i === lastAssistant 
        block.cachecontrol =  type "ephemeral" 

      return  role m.role content block 

    const response = await fetchbase/v1/messages 
      method "POST"
      signal
      headers 
        "content-type" "application/json"
        "x-api-key" cfg.apiKey
        "anthropic-version" "2023-06-01"
        "anthropic-dangerous-direct-browser-access" "true"

      body JSON.stringify
        model cfg.model
        maxtokens maxTokens
        system system
            type "text" text system cachecontrol  type "ephemeral"  
           undefined
        messages body


    if response.ok throw await readErrorresponse
    const data = await response.json
    if data.stopreason === "refusal" 
      throw new LlmError" refusal。"

    return data.content  
      .filterblock = block.type === "text"
      .mapblock = block.text
      .join""


  // OpenAI-compatible
  const body = 
  if system body.push role "system" content system 
  for const m of messages body.push role m.role content m.content 
  const response = await fetchbase/chat/completions 
    method "POST"
    signal
    headers 
      "content-type" "application/json"
      authorization Bearer cfg.apiKey

    body JSON.stringify model cfg.model maxtokens maxTokens messages body 

  if response.ok throw await readErrorresponse
  const data = await response.json
  const text = data.choices.0.message.content
  if typeof text == "string" 
    throw new LlmError"LLM ： choices0.message.content。"

  return text


/**
     * One chat completion. cfg = style baseUrl apiKey model.
     * Returns the assistant message text.
     */
export async function chatCompletecfg  system user maxTokens = 4096 signal  =  
    return chatTurncfg 
    system
    messages  role "user" content user 
    maxTokens
    signal



/** Extract the first JSON value from model output tolerates json fences and prose. */
export function extractJsontext 
  const raw = Stringtext  "".trim
  const fenced = raw.match/jsons*sS*/i
  const body = fenced  fenced1.trim  raw
  try 
    return JSON.parsebody
   catch 
    // Fall through scan for the first balanced ... or ... region.

  const start = body.search//
  if start === -1 throw new LlmError" JSON。"
  const open = bodystart
  const close = open === ""  ""  ""
  let depth = 0
  let inString = false
  let escaped = false
  for let i = start i  body.length i++ 
    const ch = bodyi
    if inString 
      if escaped escaped = false
      else if ch === "" escaped = true
      else if ch === '"' inString = false
      continue

    if ch === '"' inString = true
    else if ch === open depth += 1
    else if ch === close 
      depth -= 1
      if depth === 0 
        return JSON.parsebody.slicestart i + 1



  throw new LlmError" JSON（）。"


/** chatComplete + JSON parsing with one repair retry. */
export async function chatJsoncfg  system user maxTokens = 4096 signal  =  
    const jsonSystem = system  ""nn： JSON，。
  let first = await chatCompletecfg  system jsonSystem user maxTokens signal 
  if Stringfirst  "".trim 
    // Some reasoning models can exhaust the output budget before emitting
    // message.content. Retry the original non-empty request instead of sending
    // an invalid empty user message to the JSON repair call below.
    first = await chatCompletecfg 
      system jsonSystemn JSON，。
      user
      maxTokens Math.maxmaxTokens * 4 4096
      signal


  if Stringfirst  "".trim 
    throw new LlmError"LLM ， JSON。。"

  try 
    return extractJsonfirst
   catch 
    const repaired = await chatCompletecfg 
      system " JSON 。 JSON， JSON 。"
      user first
      maxTokens
      signal

    return extractJsonrepaired


