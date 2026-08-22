/**
 * Default worker entry point that registers ALL built-in plugins.
 */
import { initializeWorkerCore, ensureRPCSetup } from '../server/worker-core.js';
import { registerPlugins } from '../server/plugins/index.js';
import { getServerLogger } from '../logging/index.js';
import { llmPlugin, embeddingsPlugin, whisperPlugin, bciPlugin, parakeetPlugin, nmtPlugin, ttsPlugin, ocrPlugin, diffusionPlugin, audioGenPlugin, vlaPlugin, classificationPlugin } from '../server/bare/plugins/index.js';
const { hasRPCConfig } = initializeWorkerCore();
const logger = getServerLogger();
logger.info('🐻 Hello from Bare');
registerPlugins([
    llmPlugin,
    embeddingsPlugin,
    whisperPlugin,
    bciPlugin,
    parakeetPlugin,
    nmtPlugin,
    ttsPlugin,
    ocrPlugin,
    diffusionPlugin,
    audioGenPlugin,
    vlaPlugin,
    classificationPlugin
]);
logger.info(hasRPCConfig
    ? 'Parsed RPC configuration from arguments'
    : 'Using default configuration (direct mode)');
// Auto-setup RPC only if we successfully parsed RPC configuration
if (hasRPCConfig) {
    ensureRPCSetup();
}
else {
    logger.info('Running in direct mode - RPC setup will be lazy');
}
