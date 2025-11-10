const BLOCK_TIME_DIFF: number = 200; // in milliseconds, 200ms = 0.2 seconds
const BLOCK_REWARD: number = 32;
const MAX_NONCE_ATTEMPTS: number = 10_000_000;
const BC_NAME: string = "0xByteChain";
const BC_NAME_PUB: string = "0xByteChainPublicKey";
const GEN_PREV_HASH: string = "0000000000000000000000000000000000ByteChain";

const MAX_TIME_DIFF_TX = 10000;
const MIN_DIFFICULTY: number = 4;
const MAX_DIFFICULTY: number = 10;
const BLOCK_WINDOW_DIFF: number = 4; // block window for difficulty
const BLOCK_WINDOW_FEE: number = 10;

const VANITY_ADDR: string = "00000000000000000000000000000000000000000";

const print = (...data: any): void => {
    console.dir(...data, { depth: null, colors: true });
}


export { 
    BLOCK_TIME_DIFF, BLOCK_REWARD,
    BC_NAME, BC_NAME_PUB, MAX_TIME_DIFF_TX,
    VANITY_ADDR, BLOCK_WINDOW_FEE,
    GEN_PREV_HASH, BLOCK_WINDOW_DIFF, 
    MIN_DIFFICULTY, MAX_DIFFICULTY, 
    MAX_NONCE_ATTEMPTS, print
};
