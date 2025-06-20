import { createInterface } from 'node:readline';
import { parse, stringify } from 'yaml';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { HEX_KEYS_REGEX } from '../core/constants';
import { generateSecretKey } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils';
export const CONFIG_EMOJIS = {
  NOSTR: '🔑',
  RELAY: '🔄',
  SERVICE: '🤖',
  SERVER: '🖥️',
  WHITELIST: '🔒',
  SETUP: '⚙️',
  SUCCESS: '✅',
  INFO: 'ℹ️',
  PROMPT: '❯',
} as const;

export type FieldType =
  | 'string'
  | 'array'
  | 'boolean'
  | 'hex'
  | 'url'
  | 'nested'
  | 'object-array'
  | 'set';

interface ArrayItem {
  name: string;
  command: string;
  args: string[];
  [key: string]: any;
}

export interface FieldConfig {
  type: FieldType;
  description?: string;
  default?: any;
  validation?: (value: any) => boolean;
  generator?: () => any;
  required?: boolean;
  itemType?: FieldConfig;
  fields?: Record<string, FieldConfig>;
  comment?: string;
  emoji?: string;
}

export class ConfigGenerator<T extends Record<string, any>> {
  private currentConfig: T | null = null;
  constructor(
    private configPath: string,
    private fields: Record<string, FieldConfig>
  ) {
    if (existsSync(configPath)) {
      try {
        this.currentConfig = parse(readFileSync(configPath, 'utf8'));
      } catch (error) {
        console.warn(
          `${CONFIG_EMOJIS.INFO} Could not parse existing configuration`
        );
      }
    }
  }

  private async prompt(question: string, defaultValue = ''): Promise<string> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question(
        `${question}${defaultValue ? ` (${defaultValue})` : ''} `,
        (answer) => resolve(answer || defaultValue)
      );
    });

    rl.close();
    return answer;
  }

  private async promptYesNo(
    question: string,
    defaultValue = false
  ): Promise<boolean> {
    const answer = await this.prompt(
      `${question} (${defaultValue ? 'Y/n' : 'y/N'})`
    );
    return answer.trim() === ''
      ? defaultValue
      : answer.toLowerCase().startsWith('y');
  }

  private async handleObjectArrayItem(
    fields: Record<string, FieldConfig>,
    arrayName: string
  ): Promise<Record<string, any> | null> {
    const item: Record<string, any> = {};

    if (arrayName === 'servers') {
      console.log(`\n${CONFIG_EMOJIS.SERVER} Adding a new MCP server`);

      const command = await this.prompt(
        `${CONFIG_EMOJIS.SERVER} Command to run the server (e.g., node, python, npx):`
      );
      if (!command) return null;
      item.command = command;

      const args: string[] = [];
      console.log(`${CONFIG_EMOJIS.SERVER} Add command arguments:`);
      while (true) {
        const arg = await this.prompt(
          `${CONFIG_EMOJIS.SERVER} Argument (empty to finish):`
        );
        if (!arg) break;
        args.push(arg);
      }
      item.args = args;

      for (const [fieldName, fieldConfig] of Object.entries(fields)) {
        if (['command', 'args'].includes(fieldName)) continue;

        if (fieldConfig.type === 'object-array') {
          if (
            await this.promptYesNo(
              `${CONFIG_EMOJIS.SERVER} Add ${fieldName} price?`,
              fieldConfig.default || false
            )
          ) {
            const value = await this.handleField(fieldName, fieldConfig, false);
            if (value !== null) item[fieldName] = value;
          }
        } else if (fieldConfig.type === 'nested' && fieldName === 'env') {
          if (
            await this.promptYesNo(
              `${CONFIG_EMOJIS.SERVER} Add environment variables?`,
              fieldConfig.default || false
            )
          ) {
            const env: Record<string, string> = {};
            while (true) {
              const key = await this.prompt(
                `${CONFIG_EMOJIS.SERVER} Environment variable name (empty to finish):`
              );
              if (!key) break;
              const value = await this.prompt(
                `${CONFIG_EMOJIS.SERVER} Value for ${key}:`
              );
              env[key] = value;
            }
            item.env = env;
          }
        }
      }
    } else {
      const name = await this.prompt(
        `${CONFIG_EMOJIS.PROMPT} Name (empty to finish):`
      );
      if (!name) return null;

      item.name = name;

      for (const [fieldName, fieldConfig] of Object.entries(fields)) {
        if (fieldName === 'name') continue;

        const value = await this.handleField(fieldName, fieldConfig, false);
        if (value === null) return null;
        item[fieldName] = value;
      }
    }

    return item;
  }

  private async handleField(
    fieldName: string,
    config: FieldConfig,
    currentValue?: any
  ): Promise<any> {
    const emoji = config.emoji || CONFIG_EMOJIS.PROMPT;
    const description = config.description || fieldName;

    if (currentValue !== undefined) {
      if (config.type !== 'nested' && config.type !== 'object-array') {
        console.log(
          `${CONFIG_EMOJIS.INFO} ${fieldName}: ${
            typeof currentValue === 'object'
              ? JSON.stringify(currentValue)
              : currentValue
          }`
        );
      }

      const keepCurrent = await this.promptYesNo(
        `${emoji} Keep current ${description}?`,
        config.default || false
      );

      if (keepCurrent) {
        return currentValue;
      }
    }

    if (config.type === 'nested') {
      console.log(`\n${emoji} ${description}`);
    }

    const handlers: Record<FieldType, () => Promise<any>> = {
      string: async () =>
        this.promptWithValidation(
          `${emoji} ${description}:`,
          config,
          currentValue || config.default
        ),

      hex: async () => {
        if (
          config.generator &&
          (await this.promptYesNo(
            `${emoji} Generate new ${description}?`,
            config.required || false
          ))
        ) {
          const value = config.generator();
          console.log(`${CONFIG_EMOJIS.PROMPT} ${value}`);
          return value;
        }

        const existingValue = currentValue || config.default;
        existingValue &&
          console.log(`${CONFIG_EMOJIS.PROMPT} ${existingValue}`);
        return this.promptWithValidation(
          `${emoji} Enter ${description}:`,
          config,
          existingValue
        );
      },

      array: async () => {
        const array: string[] = currentValue || [];
        if (array.length > 0) {
          console.log('\nCurrent items:');
          array.forEach((item: string, index: number) => {
            console.log(
              `${CONFIG_EMOJIS.INFO} ${index + 1}. ${JSON.stringify(item)}`
            );
          });

          if (await this.promptYesNo(`${emoji} Remove any items?`, false)) {
            while (true) {
              const index =
                parseInt(
                  await this.prompt('Enter index to remove (0 to finish):')
                ) - 1;
              if (isNaN(index) || index < 0) break;
              if (index < array.length) {
                array.splice(index, 1);
                console.log('Item removed');
              }
            }
          }
        }

        if (
          await this.promptYesNo(
            `${emoji} Add ${description}?`,
            (config.default && config.required) || false
          )
        ) {
          while (true) {
            const item = await this.promptWithValidation(
              `${emoji} Enter value for ${description} (empty to finish):`,
              config,
              '',
              true
            );
            if (!item) break;
            array.push(item);
          }
        }
        return array;
      },

      set: async () => {
        const items: string[] = Array.from(currentValue || []);
        if (
          await this.promptYesNo(
            'Would you like to add items?',
            (config.default && config.required) || false
          )
        ) {
          while (true) {
            const item = await this.promptWithValidation(
              'Enter item (empty to finish):',
              config,
              '',
              true
            );
            if (!item) break;
            items.push(item);
          }
        }
        return new Set(items);
      },

      'object-array': async () => {
        let array: ArrayItem[] = currentValue || [];
        if (array.length > 0) {
          console.log(`\nCurrent ${fieldName}:`);
          array.forEach((item: ArrayItem, index: number) => {
            if (fieldName === 'servers') {
              console.log(
                `${CONFIG_EMOJIS.INFO} ${index + 1}. ${item.name} (${item.command} ${item.args?.join(' ') || ''})`
              );
            } else if (item.name) {
              console.log(`${CONFIG_EMOJIS.INFO} ${index + 1}. ${item.name}`);
            } else {
              console.log(
                `${CONFIG_EMOJIS.INFO} ${index + 1}. ${JSON.stringify(item)}`
              );
            }
          });
          console.log('');
          const keepCurrent = await this.promptYesNo(
            `${emoji} Keep current ${fieldName}?`,
            (config.default && config.required) || false
          );
          if (!keepCurrent) {
            array = [];
            console.log(`${CONFIG_EMOJIS.INFO} Cleared existing ${fieldName}.`);
          } else {
            if (
              await this.promptYesNo(
                `${emoji} Remove any existing ${fieldName}?`,
                (config.default && config.required) || false
              )
            ) {
              while (true) {
                const index =
                  parseInt(
                    await this.prompt(
                      `Enter ${fieldName} number to remove (0 to finish):`
                    )
                  ) - 1;
                if (isNaN(index) || index < 0) break;
                if (index < array.length) {
                  const itemName = array[index].name || 'item';
                  console.log(
                    `${CONFIG_EMOJIS.INFO} Removed ${fieldName}: ${itemName}`
                  );
                  array.splice(index, 1);
                }
              }
            }
          }
        }

        if (
          await this.promptYesNo(
            `${emoji} Add new ${fieldName}?`,
            (config.default && config.required) || false
          )
        ) {
          while (true) {
            const item = await this.handleObjectArrayItem(
              config.fields!,
              fieldName
            );
            if (!item) break;
            array.push(item as ArrayItem);
            const itemName = item.name || 'item';
            console.log(
              `${CONFIG_EMOJIS.INFO} Added new ${fieldName}: ${itemName}`
            );
            console.log('');
          }
        }

        return array;
      },

      nested: async () => {
        const nestedObj: Record<string, any> = {};
        if (config.fields) {
          for (const [key, fieldConfig] of Object.entries(config.fields)) {
            nestedObj[key] = await this.handleField(
              key,
              fieldConfig,
              currentValue?.[key]
            );
          }
        }
        return nestedObj;
      },

      boolean: async () =>
        this.promptYesNo(`${emoji} ${description}:`, config.default || false),
      url: async () =>
        this.promptWithValidation(
          `${emoji} Enter URL:`,
          config,
          currentValue || config.default
        ),
    };

    return handlers[config.type]();
  }

  private async validateInput(
    value: any,
    config: FieldConfig,
    allowEmpty = true
  ): Promise<boolean> {
    if (allowEmpty && value === '') return true;

    if (!config.validation) return true;

    const isValid = config.validation(value);
    if (!isValid) {
      console.log('❌ Invalid input. Please try again.');
    }
    return isValid;
  }

  private async promptWithValidation(
    question: string,
    config: FieldConfig,
    defaultValue = '',
    allowEmpty = true
  ): Promise<string> {
    while (true) {
      const value = await this.prompt(question, defaultValue);
      if (!value && !config.required && allowEmpty) return value;
      if (await this.validateInput(value, config, allowEmpty)) return value;
    }
  }

  /**
   * Remove empty values from an object recursively
   *
   * @param obj The object to clean
   * @returns The cleaned object with empty values removed
   */
  private cleanEmptyValues(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (value === '') continue;
      if (Array.isArray(value) && value.length === 0) continue;

      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        const cleaned = this.cleanEmptyValues(value);
        if (Object.keys(cleaned).length > 0) {
          result[key] = cleaned;
        }
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  async generate(): Promise<T> {
    const config: Record<string, any> = {};
    for (const [fieldName, fieldConfig] of Object.entries(this.fields)) {
      const currentValue = this.currentConfig?.[fieldName];
      config[fieldName] = await this.handleField(
        fieldName,
        fieldConfig,
        currentValue
      );
    }

    const cleanedConfig = this.cleanEmptyValues(config);

    writeFileSync(this.configPath, stringify(cleanedConfig));
    console.log(`\n${CONFIG_EMOJIS.SUCCESS} Configuration saved successfully!`);

    return cleanedConfig as T;
  }
}

export const generateHexKey = () => bytesToHex(generateSecretKey());

export const validateHexKey = (value: string) => HEX_KEYS_REGEX.test(value);

export const validateRelayUrl = (url: string) => {
  try {
    const trimmedUrl = url.trim();
    new URL(trimmedUrl);
    return trimmedUrl.startsWith('ws://') || trimmedUrl.startsWith('wss://');
  } catch {
    return false;
  }
};
