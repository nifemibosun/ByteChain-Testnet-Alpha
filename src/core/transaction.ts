import base58 from "bs58";
import elliptic_pkg from 'elliptic';
import { Address, PrivKey, PubKey } from "bc-web3js";
import { MAX_TIME_DIFF_TX, BC_NAME } from "../utils/constants.js";
import { hash_tobuf, hash_tostr } from "../utils/crypto.js";


const  { ec: EC } = elliptic_pkg;
const ec = new EC('secp256k1');


class Transaction {
    amount: number;
    sender: Address;
    recipient: Address;
    fee: number;
    tx_id: string;
    signature: string;
    nonce: number;
    timestamp: number;
    publicKey: PubKey;

    constructor(
        amount: number,
        sender: Address,
        recipient: Address,
        fee: number,
        timestamp: number,
        publicKey: PubKey,
        signature: string,
        nonce: number,
    ) {
        this.amount = amount;
        this.sender = sender;
        this.recipient = recipient;
        this.fee = fee;
        this.timestamp = timestamp;
        this.publicKey = publicKey;
        this.signature = signature;
        this.nonce = nonce;
        this.tx_id = this.compute_tx_id();;
    }

    private get_signing_data(): string {
        return `${this.amount}${this.sender}${this.recipient}${this.fee}${this.publicKey}${this.nonce}${this.timestamp}`;
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

        const { amount, sender, recipient, fee, publicKey, signature, nonce, timestamp } = this;

        if (amount === undefined || !sender || !recipient || fee === undefined || !signature || nonce === undefined || timestamp === undefined) {
            throw new Error("Incomplete transaction data.")
        }
        
        try {
            const tx_data_str = this.get_signing_data();
        
            const base58_sig = signature
            const compact_sig = base58.decode(base58_sig);

            const r = compact_sig.slice(0, 32);
            const s = compact_sig.slice(32, 64);
            const tx_signature = { r, s };
            const hashed_tx = hash_tobuf(tx_data_str);
            const key = ec.keyFromPublic(publicKey, 'hex');
            
            return key.verify(hashed_tx, tx_signature);
        } catch (err) {
            throw new Error('Transaction signature verification failed');
        }
    }

    sign_tx(priv_key: PrivKey): Transaction {
        try {
            const data_str = this.get_signing_data();
            
            const hashed_tx = hash_tobuf(data_str);
            const key_pair = ec.keyFromPrivate(priv_key, 'hex');
            const sig = key_pair.sign(hashed_tx, 'hex');
            const r = sig.r.toArrayLike(Buffer, 'be', 32);
            const s = sig.s.toArrayLike(Buffer, 'be', 32);
            const compact_sig = Buffer.concat([r, s]);
            const sign = base58.encode(compact_sig);

            this.signature = sign;

            return this;
        } catch (err) {
            throw new Error('Unable to sign transaction from tx-class');
        }
    }

    is_valid_tx(): boolean {
        try {
            const currentTime = Date.now();
            
            if (Math.abs(currentTime - this.timestamp) > MAX_TIME_DIFF_TX) {
                throw new Error('Transaction timestamp is too old or in future');
            }

            return this.verify_tx_sig();
        } catch (err) {
            throw new Error('Transaction is invalid');
        }
    }
}

export default Transaction;
