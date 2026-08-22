import { suspendRuntime } from '../../../server/bare/runtime-lifecycle.js';
import { LifecycleSuspendFailedError } from '../../../utils/errors-server.js';
export async function handleSuspend() {
    try {
        await suspendRuntime();
        return { type: 'suspend' };
    }
    catch (error) {
        throw new LifecycleSuspendFailedError(error instanceof Error ? error.message : String(error), error);
    }
}
