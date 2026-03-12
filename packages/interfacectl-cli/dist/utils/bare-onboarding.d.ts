import type { Readable, Writable } from "node:stream";
import { type InitOptions } from "../commands/init.js";
interface TtyLikeStream {
    isTTY?: boolean;
}
interface WelcomeStreams {
    input?: Readable & TtyLikeStream;
    output?: Writable & TtyLikeStream;
}
interface RunBareWelcomeOptions extends WelcomeStreams {
    initRunner?: (options: InitOptions) => Promise<number>;
}
export declare function shouldLaunchBareWelcomeFlow(args?: string[]): boolean;
export declare function runBareWelcomeFlow(options?: RunBareWelcomeOptions): Promise<number>;
export {};
//# sourceMappingURL=bare-onboarding.d.ts.map