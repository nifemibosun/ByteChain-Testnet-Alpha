import { BlockHeader }  from "bc-web3js";
import proof_of_work from "../consensus/pow.js";
import Transaction from "./transaction.js";
import calc_merkleroot from "./merkleroot.js";


class Block {
    block_header: BlockHeader;
    transactions: Transaction[];

    constructor(block_height: number, difficulty: number, prev_block_hash: string, transactions: Transaction[]) {
        this.block_header = {
            nonce: 0,
            block_height: block_height,
            timestamp: 0,
            merkleroot: "",
            prev_block_hash: prev_block_hash,
            block_hash: "",
            difficulty: difficulty,
        };
        this.transactions = transactions;
    }

    get_base_hash_input(): string {
        const { block_height, timestamp, difficulty, merkleroot,  prev_block_hash } = this.block_header;
        return `${block_height}${timestamp}${difficulty}${merkleroot}${prev_block_hash}`;
    }

    set_block_props(): { n_nonce: number, hash: string } {
        try {
            this.block_header.timestamp = Date.now();
            this.block_header.merkleroot = calc_merkleroot<Transaction>(this.transactions);

            const block_data_str = this.get_base_hash_input()

            const { n_nonce, hash } = proof_of_work(block_data_str, this.block_header.difficulty);

            this.block_header.nonce = n_nonce;
            this.block_header.block_hash = hash;

            return { n_nonce, hash };
        } catch (err) {
            throw new Error('Unable to set block property')            
        }
    }

    contain_valid_txs() {
        for (const tx of this.transactions) {
            if (!tx.is_valid_tx()) {
                throw new Error(`Invalid transaction at block ${this.block_header.block_height}`);
            }
        }

        return true;
    }
}


export default Block;