/** True on Vercel.

    Rendering used to be refused here, because the hosted build had no ffmpeg.
    It no longer is: `src/lib/binaries.ts` resolves the binary — the system one
    locally, the one bundled into the serverless output when hosted — so the
    guard that used to live in this file is gone and nothing needs to ask where
    it is running before rendering. */
export const IS_HOSTED = Boolean(process.env.VERCEL);
