import { getLifecycleState } from '../../../server/bare/runtime-lifecycle.js';
export function handleState() {
    return {
        type: 'state',
        state: getLifecycleState()
    };
}
