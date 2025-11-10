import { Address } from "bc-web3js";
import {
    BLOCK_REWARD, BLOCK_TIME_DIFF,
    MIN_DIFFICULTY, MAX_DIFFICULTY,
    BLOCK_WINDOW_DIFF, BLOCK_WINDOW_FEE,
    GEN_PREV_HASH, BC_NAME, BC_NAME_PUB,
    VANITY_ADDR
} from "../utils/constants.js";
import Transaction from "./transaction.js";
import Block from "./block.js";


interface AccState {
    nonce: number,
    balance: number,
}

class BlockChain {
    tx_pool: Transaction[];
    chain: Block[];
    difficulty: number = MIN_DIFFICULTY;
    addr_state: Map<Address, AccState>;

    constructor() {
        this.tx_pool = [];
        this.chain = [];
        this.addr_state = new Map<Address, AccState>();
        this.genesis_block();
    }

    genesis_block() {
        const gen_amount = 1000000000;
        const gen_recipient = "BC-GEN";
        const tx = new Transaction(gen_amount, BC_NAME, gen_recipient, 0, Date.now(), BC_NAME_PUB, "", 0)
        this.tx_pool.push(tx);
        const txs = this.tx_pool;
        const new_block = new Block(0, MIN_DIFFICULTY, GEN_PREV_HASH, txs);
        this.credit_addr(gen_recipient, gen_amount);
        new_block.set_block_props();

        this.chain.push(new_block);
        this.tx_pool = [];
        this.difficulty = this.calc_difficulty();
    }

    ensure_account(addr: Address) {
        if (!this.addr_state.has(addr)) {
            this.addr_state.set(addr, { nonce: 0, balance: 0 });
        }
    }

    get_nonce(addr: Address) {
        this.ensure_account(addr);
        const state = this.addr_state.get(addr)!;
        return state.nonce;
    }

    get_balance(addr: Address) {
        this.ensure_account(addr);
        const state = this.addr_state.get(addr)!;
        return state.balance;
    }

    update_nonce(addr: Address) {
        this.ensure_account(addr);
        const state = this.addr_state.get(addr)!;
        state.nonce += 1;
    }

    credit_addr(addr: Address, amount: number) {
        this.ensure_account(addr);
        const state = this.addr_state.get(addr)!;
        state.balance += amount;
    }

    debit_addr(addr: Address, amount: number) {
        this.ensure_account(addr);
        const state = this.addr_state.get(addr)!;
        if (state.balance < amount) throw new Error("Insufficient balance");
        state.balance -= amount;
    }

    get_last_block(): Block {
        const last_block = this.chain[this.chain.length - 1];
        return last_block;
    }

    get_latest_blocks(window: number): Block[] {
        let latest_blocks: Block[] = [];
        const start = Math.max(0, this.chain.length - window);

        for (let c = start; c < this.chain.length; c++) {
            let n_block = this.chain[c];
            latest_blocks.push(n_block);
        }
        
        return latest_blocks;
    }

    calculate_dynamic_fee() {
        const recent_blocks = this.get_latest_blocks(BLOCK_WINDOW_FEE);

        if (recent_blocks.length === 0) return 0.001;
        
        const avg_tx_count = recent_blocks.reduce((sum, b) => sum + b.transactions.length, 0) / BLOCK_WINDOW_FEE;
        const base_fee = 0.001;
        const congestion_factor = avg_tx_count / 100;
        const fee = base_fee * (1 + congestion_factor);

        return Math.min(fee, 0.1);
    }

    add_new_tx(tx: Transaction): Transaction {
        const { amount, sender, recipient, fee, nonce } = tx;
     
        if (amount === undefined || !sender || !recipient || fee === undefined || nonce === undefined) {
            throw new Error('Transaction data is incomplete')
        }

        try {
            if (sender === BC_NAME) {
                this.tx_pool.push(tx);
                return tx;
            }

            if(amount < 0) throw new Error("Invalid amount");

            if (fee < this.calculate_dynamic_fee()) throw new Error("Fee not valid for current chain operation");

            if (nonce !== this.get_nonce(sender) + 1) throw new Error("Invalid nonce value");

            if (!tx.verify_tx_sig()) throw new Error("Invalid Transaction signature");
            
            this.tx_pool.push(tx);
            this.debit_addr(tx.sender, tx.amount + tx.fee);

            return tx;
        } catch (err) {
            throw new Error(`Error adding transaction to tx_pool: ${(err instanceof Error) ? err.message : err}`);
        }
    }

    add_new_block(): Block {
        try {
            const { block_height, block_hash } = this.get_last_block().block_header;
            const n_block_height = block_height + 1;

            let t_fee = 0;
            for (const tx of this.tx_pool) t_fee += tx.fee;

            const fee_tx = new Transaction(t_fee, BC_NAME, VANITY_ADDR, 0, Date.now(), BC_NAME_PUB, "", 0);
            this.add_new_tx(fee_tx);
            const transactions = this.tx_pool;
            
            for (const tx of transactions) {
                this.update_nonce(tx.sender);
                this.credit_addr(tx.recipient, tx.amount);
            }

            const block = new Block(n_block_height, this.difficulty, block_hash, transactions);

            this.tx_pool = [];

            return block;
        } catch (err) {
            throw new Error('Unable to add a new block to the chain');
        }
    }

    mine_block(miner_addr: Address): Block {
        try {
            const reward_tx = new Transaction(BLOCK_REWARD, BC_NAME, miner_addr, 0, Date.now(), BC_NAME_PUB, "", 0);

            this.add_new_tx(reward_tx);

            const new_block = this.add_new_block();
            new_block.set_block_props();

            this.chain.push(new_block);
            this.difficulty = this.calc_difficulty();

            return new_block;
        } catch (err) {
            throw new Error("Error mining block");
        }
    }

    calc_difficulty(): number {
        try {
            if (this.chain.length < BLOCK_WINDOW_DIFF) {
                return this.difficulty;
            }

            const prev_block_header = this.chain[this.chain.length - BLOCK_WINDOW_DIFF].block_header;
            const n_block_header = this.get_last_block().block_header;
            const time_diff = n_block_header.timestamp - prev_block_header.timestamp;

            if (time_diff < BLOCK_TIME_DIFF) {
                this.difficulty = Math.min(MAX_DIFFICULTY, this.difficulty + 1);
            } else if (time_diff > BLOCK_TIME_DIFF) {
                this.difficulty = Math.max(MIN_DIFFICULTY, this.difficulty - 1);
            }

            return this.difficulty;
        } catch (err) {
            throw new Error("Error calculating difficulty");
        }
    }

    static is_valid_chain(chain: Block[]): boolean {
        for (const block of chain) {
            block.contain_valid_txs();
        }
        return true;
    }

    sync_chain(remote: Block[]) {
        if (remote.length > this.chain.length) {
            BlockChain.is_valid_chain(remote);
            this.chain = remote;

            this.addr_state.clear();
            for (const block of this.chain) {
                for (const tx of block.transactions) {
                    if (tx.sender !== BC_NAME) {
                        this.update_nonce(tx.sender);
                        this.debit_addr(tx.sender, tx.amount + tx.fee);
                    }
                    
                    this.credit_addr(tx.recipient, tx.amount);
                }
            }
        }
    }
}


export default BlockChain;