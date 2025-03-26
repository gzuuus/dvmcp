import debug from 'debug';

const logger = debug('dvmcp');
const loggerBridge = debug('dvmcp:bridge');
const loggerDiscovery = debug('dvmcp:discovery');

export { logger, loggerBridge, loggerDiscovery };
