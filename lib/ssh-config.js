import { createHash } from 'node:crypto'
import { appendFile, glob, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, resolve, win32 } from 'node:path'

/** One concrete `Host` alias discovered from OpenSSH user configuration. */
                                    
            
               
                   
                    
                   
               
               
 

/** Result of recursively reading OpenSSH config files and their Includes. */
                                     
                            
                 
                  
 

/** Default OpenSSH user config used by VS Code Remote - SSH as well. */
export function defaultSshConfigFiles()           {
  return process.platform === 'win32'
    ? [resolve(homedir(), '.ssh', 'config'), resolve(process.env.ProgramData ?? String.raw`C:\ProgramData`, 'ssh', 'ssh_config')]
    : [resolve(homedir(), '.ssh', 'config'), '/etc/ssh/ssh_config']
}

/** Stable settings-safe id for a config alias promoted by a workspace. */
export function discoveredSshServerId(sshTarget        )         {
  return `ssh-config-${createHash('sha256').update(sshTarget).digest('hex').slice(0, 20)}`
}

/** Discover concrete Host aliases, recursively expanding Include directives. */
export async function discoverSshConfigHosts(configFiles = defaultSshConfigFiles())                              {
  const hosts = new Map                           ()
  const visited = new Set        ()
  const files           = []
  const errors           = []

  const visit = async (configPath        , required         )                => {
    const absolute = resolve(expandHome(configPath))
    const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute
    if (visited.has(key)) return
    visited.add(key)
    let source        
    try {
      source = await readFile(absolute, 'utf8')
    } catch (error) {
      const code = errorCode(error)
      if (required || (code !== 'ENOENT' && code !== 'ENOTDIR')) errors.push(`${absolute}: ${errorMessage(error)}`)
      return
    }
    files.push(absolute)
    let active                      = []
    for (const rawLine of source.split(/\r?\n/)) {
      const tokens = tokenizeSshConfigLine(rawLine)
      if (tokens.length === 0) continue
      const [keyword, args] = splitKeyword(tokens)
      const lower = keyword.toLowerCase()
      if (lower === 'include') {
        for (const pattern of args) {
          const matches = await expandInclude(pattern, dirname(absolute))
          for (const match of matches) await visit(match, false)
        }
        continue
      }
      if (lower === 'match') {
        active = []
        continue
      }
      if (lower === 'host') {
        active = []
        for (const alias of args) {
          if (!isConcreteAlias(alias)) continue
          let host = hosts.get(alias)
          if (host === undefined) {
            host = {
              id: discoveredSshServerId(alias),
              label: alias,
              sshTarget: alias,
              configPath: absolute,
            }
            hosts.set(alias, host)
          }
          active.push(host)
        }
        continue
      }
      if (active.length === 0 || args[0] === undefined) continue
      if (lower === 'hostname') for (const host of active) host.hostName ??= args[0]
      else if (lower === 'user') for (const host of active) host.user ??= args[0]
      else if (lower === 'port') {
        const port = Number(args[0])
        if (Number.isSafeInteger(port) && port > 0 && port <= 65_535) for (const host of active) host.port ??= port
      }
    }
  }

  for (const configPath of configFiles) await visit(configPath, false)
  return {
    hosts: [...hosts.values()].sort((left, right) => left.label.localeCompare(right.label)),
    files,
    errors,
  }
}

/** Parsed subset of `ssh` CLI syntax written by the Add New SSH Host flow. */
                             
               
                  
               
               
                       
 

/** One executable SSH connection with no remote command attached. */
                                          
                    
                   
                   
 

/**
 * Parse a pasted OpenSSH command for immediate use by `/connect`. Connection
 * options are preserved instead of being written to config. Options that own
 * forwarding or execute a remote command are rejected because the Backend
 * transport supplies both itself.
 */
export function parseSshConnectionInvocation(command        )                          {
  if (/\r|\n/.test(command)) throw new Error('SSH connection command must be one line')
  const argv = tokenizeSshConfigLine(command)
  const executable = argv.shift()
  if (executable === undefined || !/^ssh(?:\.exe)?$/i.test(win32.basename(executable)) && basename(executable) !== 'ssh') {
    throw new Error('SSH connection command must start with ssh')
  }
  const sshArgs           = []
  let sshTarget                    
  const optionsWithValue = new Set(['-B', '-b', '-c', '-E', '-F', '-I', '-i', '-J', '-l', '-m', '-o', '-P', '-p', '-S'])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]          
    if (sshTarget !== undefined) throw new Error('SSH connection command must not include a remote command')
    if (argument === '--') {
      const target = argv[index + 1]
      if (target === undefined || index + 2 !== argv.length) throw new Error('SSH connection command requires one destination')
      sshTarget = target
      break
    }
    if (!argument.startsWith('-') || argument === '-') {
      sshTarget = argument
      continue
    }
    if (/^-[46AaCqTtvXxYy]+$/u.test(argument)) {
      sshArgs.push(argument)
      continue
    }
    const option = argument.slice(0, 2)
    if (!optionsWithValue.has(option)) throw new Error(`unsupported SSH argument '${argument}'`)
    sshArgs.push(argument)
    if (argument.length > 2) continue
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`missing value for ${argument}`)
    sshArgs.push(value)
    index += 1
  }
  if (sshTarget === undefined) throw new Error('SSH connection command requires a destination')
  if (sshTarget === '' || /\s|[*?!\[\]]/.test(sshTarget)) throw new Error('SSH destination must be one concrete host')
  return { executable, sshArgs, sshTarget }
}

/** Parse a VS Code-style `ssh user@host -p 22` connection command. */
export function parseSshConnectionCommand(command        )             {
  if (/\r|\n/.test(command)) throw new Error('SSH connection command must be one line')
  const argv = tokenizeSshConfigLine(command)
  const executable = argv.shift()
  if (executable === undefined || !/^ssh(?:\.exe)?$/i.test(win32.basename(executable)) && basename(executable) !== 'ssh') {
    throw new Error('SSH connection command must start with ssh')
  }
  let user                    
  let port                    
  let identityFile                    
  let destination                    
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]          
    const value = () => {
      const next = argv[index + 1]
      if (next === undefined) throw new Error(`missing value for ${argument}`)
      index += 1
      return next
    }
    if (argument === '-p') port = parsePort(value())
    else if (argument === '-l') user = value()
    else if (argument === '-i') identityFile = value()
    else if (argument === '-o') {
      const option = value()
      const separator = option.indexOf('=')
      const key = (separator < 0 ? option : option.slice(0, separator)).toLowerCase()
      const optionValue = separator < 0 ? '' : option.slice(separator + 1)
      if (key === 'user') user = requiredOptionValue(option, optionValue)
      else if (key === 'port') port = parsePort(requiredOptionValue(option, optionValue))
      else if (key === 'identityfile') identityFile = requiredOptionValue(option, optionValue)
      else if (key !== 'hostname') throw new Error(`unsupported SSH option '${option}'`)
    } else if (argument.startsWith('-')) {
      throw new Error(`unsupported SSH argument '${argument}'`)
    } else if (destination === undefined) destination = argument
    else throw new Error('SSH connection command has more than one destination')
  }
  if (destination === undefined) throw new Error('SSH connection command requires a destination')
  const at = destination.lastIndexOf('@')
  if (at >= 0) {
    user ??= destination.slice(0, at)
    destination = destination.slice(at + 1)
  }
  if (destination === '' || /\s|[*?!\[\]]/.test(destination)) throw new Error('SSH destination must be one concrete host')
  if (user !== undefined && (user === '' || /\s/.test(user))) throw new Error('SSH user is invalid')
  return { alias: destination, hostName: destination, ...(user === undefined ? {} : { user }), ...(port === undefined ? {} : { port }), ...(identityFile === undefined ? {} : { identityFile }) }
}

/** Append a parsed host to one selected OpenSSH config file. */
export async function appendSshHost(configPath        , command        )                      {
  const absolute = resolve(expandHome(configPath))
  const host = parseSshConnectionCommand(command)
  const existing = await discoverSshConfigHosts([absolute])
  if (existing.hosts.some(candidate => candidate.sshTarget === host.alias)) throw new Error(`SSH Host '${host.alias}' already exists in ${absolute}`)
  await mkdir(dirname(absolute), { recursive: true })
  let prefix = ''
  try {
    const current = await readFile(absolute)
    if (current.length > 0 && current.at(-1) !== 0x0a) prefix = '\n'
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
  const lines = [
    `${prefix}Host ${host.alias}`,
    `  HostName ${formatSshValue(host.hostName)}`,
    ...(host.user === undefined ? [] : [`  User ${formatSshValue(host.user)}`]),
    ...(host.port === undefined ? [] : [`  Port ${host.port}`]),
    ...(host.identityFile === undefined ? [] : [`  IdentityFile ${formatSshValue(host.identityFile)}`]),
    '',
  ]
  await appendFile(absolute, lines.join('\n'), 'utf8')
  return host
}

function splitKeyword(tokens          )                     {
  const first = tokens[0] ?? ''
  const equals = first.indexOf('=')
  if (equals < 0) return [first, tokens.slice(1)]
  return [first.slice(0, equals), [first.slice(equals + 1), ...tokens.slice(1)].filter(Boolean)]
}

function tokenizeSshConfigLine(line        )           {
  const tokens           = []
  let token = ''
  let quote                       
  let escaped = false
  const push = () => {
    if (token !== '') tokens.push(token)
    token = ''
  }
  for (const character of line.trim()) {
    if (escaped) {
      token += character
      escaped = false
    } else if (character === '\\') {
      escaped = true
    } else if (quote !== undefined) {
      if (character === quote) quote = undefined
      else token += character
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '#') {
      break
    } else if (/\s/.test(character)) {
      push()
    } else {
      token += character
    }
  }
  if (escaped) token += '\\'
  push()
  return tokens
}

function isConcreteAlias(alias        )          {
  return alias !== '' && !alias.startsWith('!') && !/[*?\[]/.test(alias)
}

async function expandInclude(pattern        , baseDir        )                    {
  const expanded = expandHome(pattern)
  const absolute = isAbsolute(expanded) ? expanded : resolve(baseDir, expanded)
  const matches           = []
  try {
    for await (const match of glob(absolute.replaceAll('\\', '/'))) matches.push(resolve(match))
  } catch {
    // Invalid or unsupported Include patterns are reported by OpenSSH when a
    // connection uses them; discovery simply leaves those entries absent.
  }
  return matches.sort()
}

function expandHome(path        )         {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return resolve(homedir(), path.slice(2))
  return path
}

function errorCode(error         )                     {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

function errorMessage(error         )         {
  return error instanceof Error ? error.message : String(error)
}

function parsePort(value        )         {
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) throw new Error(`invalid SSH port '${value}'`)
  return port
}

function requiredOptionValue(option        , value        )         {
  if (value === '') throw new Error(`SSH option '${option}' requires =value`)
  return value
}

function formatSshValue(value        )         {
  return /\s|#/.test(value) ? `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` : value
}
