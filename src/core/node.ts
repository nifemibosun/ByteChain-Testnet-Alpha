import fs from "fs";
import cors from "cors";
import express from "express";
import type { Request, Response } from "express";
import { Account, type PubKey } from "bc-web3js";
import P2PNode from "../network/p2p.js";
import BlockChain from "./blockchain.js";
import Transaction from "./transaction.js";
import { print } from "../utils/constants.js";
import { Server } from "socket.io";


function read_file() {
    try {
        const file_path = "bc-setup.json";
        const bc_setup = fs.readFileSync(file_path, "utf-8");
        const bc_setup_obj = JSON.parse(bc_setup);
        const miner_addr = bc_setup_obj.blockchain_addr;
        const p2p_port = bc_setup_obj.p2p_port;
        const api_port = bc_setup_obj.api_port;

        return { miner_addr, p2p_port, api_port };
    } catch (err) {
        throw new Error("Unable to read data from bc-setup.json");
    }
}

class BCNode {
    private p2p_port: number;
    private api_port: number;
    private miner_addr: PubKey;
    private bytechain: BlockChain;
    private p2p: P2PNode;
    public app: express.Application;
    public io?: Server;

    constructor() {
        this.p2p_port = read_file().p2p_port;
        this.api_port = read_file().api_port;
        this.miner_addr = read_file().miner_addr;
        this.bytechain = new BlockChain();
        this.p2p = new P2PNode(this.bytechain);
        this.app = express();
        this.setup_api_endpoints();
    }

    private setup_api_endpoints() {
        this.app.use(cors());
        this.app.use(express.json());

        this.app.get("/new-account", (_: Request, res: Response) => {
            const { priv_key, pub_key } = Account.new();
            res.status(200).json({ priv_key, pub_key });
        });

        this.app.post("/tx/send", async (req: Request, res: Response) => {
            try {
                const tx_data = req.body;
                
                const new_tx = new Transaction(
                    tx_data.amount,
                    tx_data.sender,
                    tx_data.recipient,
                    tx_data.fee,
                    tx_data.timestamp,
                    tx_data.nonce,
                    tx_data.signature
                );

                const tx_result = this.bytechain.add_new_tx(new_tx);
                if (tx_result) {
                    this.p2p.publish_tx(new_tx);
                    return res.status(200).json({ status: "success", msg: `Tx id: ${new_tx.tx_id}` });
                } else {
                    return res
                        .status(200)
                        .json({ status: "error", msg: "Failed to add transaction. Invalid or Insufficient fund" });
                }
            } catch (err: any) {
                console.error(`Error sending transaction: ${err}`);
                return res.status(500).json({ status: "error", msg: "Internal server error", details: err.message });
            }
        });

        this.app.get("/balance/:address", (req: Request, res: Response) => {
            const addr = req.params.address.toString();

            const balance = this.bytechain.get_balance(addr);
            res.status(200).json({ address: addr, balance });
        });

        this.app.get("/nonce/:address", (req: Request, res: Response) => {
            const addr = req.params.address.toString();

            const nonce = this.bytechain.get_nonce(addr);
            res.status(200).json({ address: addr, nonce });
        });

        this.app.get("/fee", (_: Request, res: Response) => {
            const fee = this.bytechain.calculate_dynamic_fee();
            res.status(200).json({ fee });
        });

        this.app.get("/chain", (_: Request, res: Response) => {
            res.status(200).json(this.bytechain.chain);
        });

        this.app.get("/chain/latest", (_: Request, res: Response) => {
            res.status(200).json(this.bytechain.get_latest_block());
        });

        this.app.get("/chain/:number", (req: Request, res: Response) => {
            const block_num = Number(req.params.number);
            if (
                isNaN(block_num) ||
                !Number.isInteger(block_num) ||
                block_num < 0 ||
                block_num >= this.bytechain.chain.length
            ) {
                return res.status(400).json({ status: "error", msg: `Error: Invalid block number '${block_num}'` });
            }

            return res.status(200).json(this.bytechain.chain[block_num]);
        });

        this.app.get("/chain/:start/:end", (req: Request, res: Response) => {
            const block_start = Number(req.params.start);
            const block_end = Number(req.params.end);

            if (
                isNaN(block_start) || !Number.isInteger(block_start) ||
                block_start < 0 || block_start >= this.bytechain.chain.length ||
                isNaN(block_end) || !Number.isInteger(block_end) ||
                block_end < 0 || block_end >= this.bytechain.chain.length
            ) {
                return res.status(400).json({ status: "error", msg: "Error: Chain does not include such blocks" });
            }

            if (block_start > block_end) {
                return res.status(400).json({ status: "error", msg: "Error: start must be <= end" });
            }

            return res.status(200).json(this.bytechain.get_multiple_blocks(block_start, block_end));
        });

        this.app.get("/tx/pool", (_: Request, res: Response) => {
            res.status(200).json(this.bytechain.tx_pool);
        });

        this.app.get("/status", (_: Request, res: Response) => {
            res.status(200).json({
                status: "running",
                peer_id: this.p2p.node ? this.p2p.node.peerId.toString() : "N/A",
                p2p_port: this.p2p_port,
                api_port: this.api_port,
                chain_len: this.bytechain.chain.length,
                pending_tx_count: this.bytechain.tx_pool.length,
            });
        });
    }

    async start(server?: any) {
        await this.p2p.start(this.p2p_port);

        if (server) {
            server
                .listen(this.api_port, () => {
                  print(`ByteChain HTTP server started on port ${this.api_port}`);
                })
                .on("error", (_: any) => {
                  print(`Failed to start HTTP server on port ${this.api_port}`);
                  process.exit(1);
                });
        } else {
            this.app
                .listen(this.api_port, () => {
                  print(`ByteChain HTTP server started on port ${this.api_port}`);
                })
                .on("error", (_: any) => {
                  print(`Failed to start HTTP server on port ${this.api_port}`);
                  process.exit(1);
                });
        }
    }

    async stop() {
        await this.p2p.stop();
        print("P2P and HTTP server stopped");
    }

    pub_tx(tx: Transaction) {
        const result = this.bytechain.add_new_tx(tx);
        if (result) {
            this.p2p.publish_tx(tx);
        } else {
            console.error("Failed to add transaction to tx_pool.");
        }
    }

    pub_block() {
        try {
            const new_block = this.bytechain.mine_block(this.miner_addr);
            if (new_block) {
                this.p2p.publish_block(new_block);
                if (this.io) {
                    this.io.emit("blockMined", new_block);
                }
            } else {
                console.error("Failed to mine block.");
            }
        } catch (err: any) {
            console.error(`Exception during block mining: ${err.message || err}`);
        }
    }
}

export default BCNode;
