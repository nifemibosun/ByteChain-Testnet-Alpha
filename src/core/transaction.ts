import base58 from "bs58";
import elliptic_pkg from 'elliptic';
import type { PubKey } from "bc-web3js";
import { MAX_TIME_DIFF_TX, BC_NAME } from "../utils/constants.js";
import { hash_tobuf, hash_tostr } from "../utils/crypto.js";


const  { ec: EC } = elliptic_pkg;
const ec = new EC('secp256k1');


class Transaction {
    public amount: number;
    public sender: PubKey;
    public recipient: PubKey;
    public fee: number;
    public timestamp: number;
    public tx_id: string;
    public nonce: number;
    public signature: string;

    constructor(
        amount: number,
        sender: PubKey,
        recipient: PubKey,
        fee: number,
        timestamp: number,
        nonce: number,
        signature: string,
    ) {
        this.amount = amount;
        this.sender = sender;
        this.recipient = recipient;
        this.fee = fee;
        this.timestamp = timestamp;
        this.tx_id = this.compute_tx_id();
        this.nonce = nonce;
        this.signature = signature;
    }

    private get_signing_data(): string {
        return `${this.amount}${this.sender}${this.recipient}${this.fee}${this.nonce}${this.timestamp}`;
    }

    private compute_tx_id(): string {
        const data = this.get_signing_data();
        const id = hash_tostr(data);
        
        return id;
    }

    verify_tx_sig(): boolean {
        if (this.sender === BC_NAME) {
            return true;
        }

        const { amount, sender, recipient, fee, signature, nonce, timestamp } = this;

        if (amount === undefined || !sender || !recipient || fee === undefined || !signature || nonce === undefined || timestamp === undefined) {
            throw new Error("Incomplete transaction data.")
        }
        
        try {
            if (typeof signature !== 'string') {
                throw new Error("signature must be a base58 string");
            }

            const tx_data_str = this.get_signing_data();
        
            const base58_sig = signature
            const compact_sig = base58.decode(base58_sig);

            const r = compact_sig.slice(0, 32);
            const s = compact_sig.slice(32, 64);
            const tx_signature = { r, s };
            const hashed_tx = hash_tobuf(tx_data_str);
            const key = ec.keyFromPublic(this.sender, 'hex');
            
            return key.verify(hashed_tx, tx_signature);
        } catch (err) {
            throw new Error('Transaction signature verification failed');
        }
    }

    is_valid_tx(): boolean {
        try {
            const currentTime = Date.now();
            
            if (Math.abs(currentTime - this.timestamp) > MAX_TIME_DIFF_TX) {
                throw new Error('Transaction timestamp is too old');
            }

            return this.verify_tx_sig();
        } catch (err) {
            throw new Error('Transaction is invalid');
        }
    }
}

export default Transaction;
