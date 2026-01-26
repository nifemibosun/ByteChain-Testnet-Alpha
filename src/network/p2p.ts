import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { kadDHT } from '@libp2p/kad-dht';
import { bootstrap } from '@libp2p/bootstrap';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { mdns } from '@libp2p/mdns';
import { ping } from '@libp2p/ping';
import { lpStream } from 'it-length-prefixed-stream';
import BlockChain from '../core/blockchain.js';
import Block from '../core/block.js';
import Transaction from '../core/transaction.js';

import { serialize_tx, deserialize_tx,
    serialize_block, deserialize_block
 } from '../utils/serialization.js';
import { print } from '../utils/constants.js';


class P2PNode {
    node: any;
    blockchain: BlockChain;
    MEMPOOL_SYNC_PROTOCOL = '/bytechain/mempool/0.0.1';
    CHAIN_SYNC_PROTOCOL = '/bytechain/sync/0.0.1';

    constructor(blockchainInstance: BlockChain) {
        this.blockchain = blockchainInstance;
    }

    async start(port: number, bootstrap_peers: string[] = []) {
        const peer_discovery_config: any[] = [
            mdns({ interval: 20e3 })
        ];

        if (bootstrap_peers.length > 0) {
            print(`Configuring bootstrap with ${bootstrap_peers.length} peer(s)...`);
            peer_discovery_config.push(
                bootstrap({
                    list: bootstrap_peers
                })
            );
        }

        this.node = await createLibp2p({
            addresses: {
                listen: [
                    `/ip6/::/tcp/${port}`,
                    `/ip6/::/tcp/${port + 1}/ws`,
                    `/ip4/0.0.0.0/tcp/${port}`,
                ]
            },
            transports: [
                tcp(),
                webSockets()
            ],
            connectionEncrypters: [noise()],
            streamMuxers: [yamux()],
            peerDiscovery: peer_discovery_config,
            services: {
                identify: identify(),
                ping: ping(),
                dht: kadDHT({ clientMode: false }),
                pubsub: gossipsub({
                    allowPublishToZeroTopicPeers: true,
                    D: 2, 
                    Dlo: 1,
                    Dhi: 3,
                })
            }
        });

        this.node.addEventListener('peer:discovery', (evt: any) => {
            const peer_id = evt.detail.id;
            print(`Discovered peer: ${peer_id}`);
            this.node.dial(peer_id).catch((_: any) => {});
        });

        await this.node.handle(this.MEMPOOL_SYNC_PROTOCOL, async ({ stream }: any) => {
            const lp = lpStream(stream);
            try {
                const mempool_data = JSON.stringify(this.blockchain.tx_pool);
                await lp.write(new TextEncoder().encode(mempool_data));
            } catch (err: any) {
                console.error(`Error sharing mempool: ${err}`)
            } finally {
                stream.close();
            }
            
            print("Shared mempool with a peer.");
        });

        await this.node.handle(this.CHAIN_SYNC_PROTOCOL, async ({ stream }: any) => {
            const lp = lpStream(stream);
            
            try {
                while (true) {
                    const data = await lp.read();
                    if (!data) break;

                    const request = JSON.parse(new TextDecoder().decode(data.subarray()));
                    const height = this.blockchain.get_latest_block().block_header.block_height;

                    if (request.type === 'GET_HEIGHT') {
                        await lp.write(new TextEncoder().encode(JSON.stringify({ height })));
                    } else if (request.type === 'GET_BLOCKS') {
                        const blocks_to_send = this.blockchain.get_multiple_blocks(request.fromHeight, height);
                        await lp.write(new TextEncoder().encode(JSON.stringify({ blocks: blocks_to_send })));
                    }
                }
            } catch (err) {
                console.error(`Error syncing chain: ${err}`)
            } finally {
                await stream.close();
            }
        });

        this.node.addEventListener('peer:connect', async (evt: any) => {
            const peer_id = evt.detail;
            await this.sync_remote_chain(peer_id);
            await this.request_mempool(peer_id);
            print(`Connected to peer: ${peer_id.toString()}`);
        });

        this.node.addEventListener('peer:disconnect', (evt: any) => {
            const peer_id = evt.detail;
            print(`Disconnected from peer: ${peer_id.toString()}`);
        });

        await this.node.start();
        print(`ByteChain P2P Node started with peer ID: ${this.node.peerId.toString()}`);
        print(`Listening on: ${this.node.getMultiaddrs().map((ma: any) => ma.toString())}`);
        await this.subscribe_to_topics();
    }

    async stop() {
        await this.node.stop();
        print('P2P Node stopped');
    }

    async subscribe_to_topics() {
        this.node.services.pubsub.subscribe('bytechain:transactions');
        this.node.services.pubsub.subscribe('bytechain:blocks');
        print('Subscribed to GossipSub topics');

        this.node.services.pubsub.addEventListener('message', (evt: any) => {
            if (evt.detail.from.toString() === this.node.peerId.toString()) return;

            const { topic, data } = evt.detail;
            const message_string = new TextDecoder().decode(data);
            let message: any;

            try {
                message = JSON.parse(message_string);
            } catch (error) {
                console.error('Error parsing JSON message:', error);
                return;
            }

            switch (topic) {
                case 'bytechain:transactions':
                    print(`Received new transaction from peer on topic ${topic}`);
                    try {
                        const received_tx = deserialize_tx(message);

                        if (!this.blockchain.tx_pool.find((tx: any) => tx.tx_id === received_tx.tx_id)) {
                            const add_result = this.blockchain.add_new_tx(received_tx);
                            if(add_result) print("Transaction added to pool");
                        }
                    } catch (error: any) {
                        console.error('Processing Tx Error:', error.message);
                    }
                    break;
                case 'bytechain:blocks':
                    print("Received new block from peer");
                    try {
                        const received_block = deserialize_block(message);
                        
                        if (received_block.block_header.block_height > this.blockchain.get_latest_block().block_header.block_height) {
                            print(`Syncing block ${received_block.block_header.block_height}...`);
                        }
                    } catch (error: any) {
                        console.error('Processing Block Error:', error.message);
                    }
                    break;
                default:
                    print(`Received message on unknown topic ${topic}`);
            }
        });
    }

    async publish_tx(tx: Transaction) {
        if (this.node.getPeers().length === 0) {
            print("Warning: No peers connected. Transaction will not propagate.");
        }
        
        const serialized_tx = serialize_tx(tx);
        const json_string = JSON.stringify(serialized_tx);
        await this.node.services.pubsub.publish('bytechain:transactions', new TextEncoder().encode(json_string));
        print(`Published transaction: ${tx.tx_id}`);
    }

    async publish_block(block: Block) {
        const serialized_block = serialize_block(block);
        const json_string = JSON.stringify(serialized_block);
        await this.node.services.pubsub.publish('bytechain:blocks', new TextEncoder().encode(json_string));
        print(`New block published: Height: ${block.block_header.block_height}, Hash: ${block.block_header.block_hash}, tx count: ${block.transactions.length}`);
    }

    async sync_remote_chain(peerId: any) {
        let stream;
        try {
            stream = await this.node.dialProtocol(peerId, this.CHAIN_SYNC_PROTOCOL);
            const lp = lpStream(stream);

            await lp.write(new TextEncoder().encode(JSON.stringify({ type: 'GET_HEIGHT' })));
            const height_result = await lp.read();
            const { height: remote_height } = JSON.parse(new TextDecoder().decode(height_result.slice()));

            const local_height = this.blockchain.get_latest_block().block_header.block_height;

            if (remote_height > local_height) {
                print(`Peer is ahead ($${remote_height} > ${local_height}$). Requesting blocks...`);
                
                await lp.write(new TextEncoder().encode(JSON.stringify({ 
                    type: 'GET_BLOCKS', 
                    fromHeight: local_height + 1 
                })));
                
                const blocks_result = await lp.read();

                if (blocks_result) {
                    const { blocks } = JSON.parse(new TextDecoder().decode(blocks_result.subarray()));
                    let received_blocks: Block[] = [];

                    blocks.forEach((blockData: any) => {
                        const block = deserialize_block(blockData);
                        received_blocks.push(block)
                    });

                    this.blockchain.sync_chain(received_blocks) 
                    print(`Successfully synced ${blocks.length} blocks.`);
                }
            } else {
                print("Chain is already up to date.");
            }
        } catch (err: any) {
            console.error(`Chain Sync failed with ${peerId.toString()}:`, err.message);
        } finally {
            if (stream) stream.close();
        }
    }

    async request_mempool(peerId: any) {
        let stream;
        try {
            stream = await this.node.dialProtocol(peerId, this.MEMPOOL_SYNC_PROTOCOL);
            const lp = lpStream(stream);
            
            const response = await lp.read();
            if (response) {
                const mempoolString = new TextDecoder().decode(response.subarray());
                const remoteMempool = JSON.parse(mempoolString);
                
                print(`Received ${remoteMempool.length} transactions from peer.`);
                
                remoteMempool.forEach((txData: any) => {
                    const tx = deserialize_tx(txData);
                    if (!this.blockchain.tx_pool.find(t => t.tx_id === tx.tx_id)) {
                        this.blockchain.add_new_tx(tx);
                    }
                });
            }
        } catch (err: any) {
            console.error(`Mempool sync failed:`, err.message);
        } finally {
            if (stream) stream.close();
        }
    }
}

export default P2PNode;