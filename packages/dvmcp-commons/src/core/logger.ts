import debug from 'debug';

const logger = debug('dvmcp');
const loggerBridge = debug('dvmcp:bridge');
const loggerDiscovery = debug('dvmcp:discovery');
const customLogger = (namespace: string) => debug(namespace);
export { logger, loggerBridge, loggerDiscovery, customLogger };
