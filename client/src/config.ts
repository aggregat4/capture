import { Config } from './shared-types'

const CONFIG_KEY = 'editor_config'

const defaultConfig: Config = {
  documentName: 'default-doc',
  password: ''
}

export const loadConfig = (): Config => {
  const stored = localStorage.getItem(CONFIG_KEY)
  return stored ? JSON.parse(stored) : defaultConfig
}

export const saveConfig = (config: Config): void => {
  if (!config.password) {
    throw new Error('Password is required')
  }
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
} 