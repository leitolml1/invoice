import { resumeRuntime } from '../../../server/bare/runtime-lifecycle.js';
import { LifecycleResumeFailedError } from '../../../utils/errors-server.js';
export async function handleResume() {
    try {
        await resumeRuntime();
        return { type: 'resume' };
    }
    catch (error) {
        throw new LifecycleResumeFailedError(error instanceof Error ? error.message : String(error), error);
    }
}
