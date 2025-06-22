import debug from 'debug';

class Logger {
  private logger: debug.Debugger;

  constructor(namespace: string) {
    this.logger = debug(namespace);
  }

  info(message: string, ...args: any[]) {
    this.logger(`INFO: ${message}`, ...args);
  }

  warn(message: string, ...args: any[]) {
    this.logger(`WARN: ${message}`, ...args);
  }

  error(message: string, ...args: any[]) {
    this.logger(`ERROR: ${message}`, ...args);
  }

  debug(message: string, ...args: any[]) {
    this.logger(`DEBUG: ${message}`, ...args);
  }
}

const logger = new Logger('dvmcp');
const loggerBridge = new Logger('dvmcp:bridge');
const loggerDiscovery = new Logger('dvmcp:discovery');
const customLogger = (namespace: string) => new Logger(namespace);

export { logger, loggerBridge, loggerDiscovery, customLogger };
