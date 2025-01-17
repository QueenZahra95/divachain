/**
 * Copyright (C) 2021-2022 diva.exchange
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * Author/Maintainer: DIVA.EXCHANGE Association, https://diva.exchange
 */

import { Config } from '../config';
import { Logger } from '../logger';
import createError from 'http-errors';
import express, { Express, NextFunction, Request, Response } from 'express';
import http from 'http';
import WebSocket from 'ws';
import compression from 'compression';
import { Bootstrap } from './bootstrap';
import { Blockchain } from '../chain/blockchain';
import { Validation } from './validation';
import { Wallet } from '../chain/wallet';
import { Network } from './network';
import { Message } from './message/message';
import { Api } from './api';
import { ArrayCommand, CommandModifyStake } from '../chain/transaction';
import { BlockFactory } from './block-factory';
import { BlockStruct } from '../chain/block';

export class Server {
  public readonly config: Config;
  public readonly app: Express;

  private readonly httpServer: http.Server;
  private readonly webSocketServerBlockFeed: WebSocket.Server;

  private blockFactory: BlockFactory = {} as BlockFactory;

  private bootstrap: Bootstrap = {} as Bootstrap;
  private wallet: Wallet = {} as Wallet;
  private network: Network = {} as Network;
  private blockchain: Blockchain = {} as Blockchain;
  private validation: Validation = {} as Validation;

  private mapModifyStake: Map<string, CommandModifyStake> = new Map();
  private mapStakeCredit: Map<string, number> = new Map();
  private timeoutModifyStake: NodeJS.Timeout = {} as NodeJS.Timeout;

  private timeoutAddTx: NodeJS.Timeout = {} as NodeJS.Timeout;
  private timeoutDoSign: NodeJS.Timeout = {} as NodeJS.Timeout;

  constructor(config: Config) {
    this.config = config;
    Logger.info(`divachain ${this.config.VERSION} instantiating...`);

    // express application
    this.app = express();
    // hide express
    this.app.set('x-powered-by', false);

    // compression
    this.app.use(compression());

    // json
    this.app.use(express.json());

    // catch unavailable favicon.ico
    this.app.get('/favicon.ico', (req: Request, res: Response) => {
      res.sendStatus(204);
    });

    // init API
    Api.make(this);
    Logger.info('Api initialized');

    // catch 404 and forward to error handler
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      next(createError(404));
    });

    // error handler
    this.app.use(Server.error);

    // Web Server
    this.httpServer = http.createServer(this.app);
    this.httpServer.on('listening', () => {
      Logger.info(`HttpServer listening on ${this.config.ip}:${this.config.port}`);
    });
    this.httpServer.on('close', () => {
      Logger.info(`HttpServer closing on ${this.config.ip}:${this.config.port}`);
    });

    // standalone Websocket Server to feed block updates
    this.webSocketServerBlockFeed = new WebSocket.Server({
      host: this.config.ip,
      port: this.config.port_block_feed,
      perMessageDeflate: false,
    });
    this.webSocketServerBlockFeed.on('connection', (ws: WebSocket) => {
      ws.on('error', (error: any) => {
        Logger.warn('WebSocketServerBlockFeed.error: ' + error.toString());
        ws.terminate();
      });
    });
    this.webSocketServerBlockFeed.on('close', () => {
      Logger.info(`WebSocket Server closing on ${this.config.ip}:${this.config.port_block_feed}`);
    });
    this.webSocketServerBlockFeed.on('listening', () => {
      Logger.info(`WebSocket Server listening on ${this.config.ip}:${this.config.port_block_feed}`);
    });
  }

  async start(): Promise<Server> {
    Logger.info(`HTTP endpoint ${this.config.http}`);
    Logger.info(`UDP endpoint ${this.config.udp}`);

    this.wallet = Wallet.make(this.config);
    Logger.info('Wallet initialized');

    this.blockchain = await Blockchain.make(this);
    if (this.blockchain.getHeight() === 0) {
      await this.blockchain.reset(Blockchain.genesis(this.config.path_genesis));
    }
    Logger.info('Blockchain initialized');

    this.validation = Validation.make(this);
    Logger.info('Validation initialized');

    this.network = Network.make(this, (m: Message) => {
      this.blockFactory.processMessage(m);
    });

    this.blockFactory = BlockFactory.make(this);
    Logger.info('BlockFactory initialized');

    await this.httpServer.listen(this.config.port, this.config.ip);

    return new Promise((resolve) => {
      this.network.once('ready', async () => {
        this.bootstrap = Bootstrap.make(this);
        if (this.config.bootstrap) {
          // bootstrapping (entering the network)
          await this.bootstrap.syncWithNetwork();
          if (!this.blockchain.hasNetworkHttp(this.config.http)) {
            await this.bootstrap.joinNetwork(this.wallet.getPublicKey());
          }
        }

        resolve(this);
      });
    });
  }

  async shutdown(): Promise<void> {
    clearTimeout(this.timeoutModifyStake);
    clearTimeout(this.timeoutAddTx);
    clearTimeout(this.timeoutDoSign);

    this.network.shutdown();
    this.wallet.close();
    await this.blockchain.shutdown();

    if (this.httpServer) {
      return await new Promise((resolve) => {
        this.httpServer.close(() => {
          resolve();
        });
      });
    } else {
      return Promise.resolve();
    }
  }

  getBootstrap(): Bootstrap {
    return this.bootstrap;
  }

  getWallet(): Wallet {
    return this.wallet;
  }

  getBlockchain(): Blockchain {
    return this.blockchain;
  }

  getValidation(): Validation {
    return this.validation;
  }

  getNetwork(): Network {
    return this.network;
  }

  getBlockFactory(): BlockFactory {
    return this.blockFactory;
  }

  proposeModifyStake(forPublicKey: string, ident: string, stake: number) {
    const k = [forPublicKey, ident, stake].join('');
    if (this.mapModifyStake.has(k)) {
      return;
    }

    // place a vote for stake increase
    const command = {
      command: Blockchain.COMMAND_MODIFY_STAKE,
      publicKey: forPublicKey,
      ident: ident,
      stake: stake,
    } as CommandModifyStake;

    // algorithm for credits equalizes the stake distribution
    const credit = (this.mapStakeCredit.get(forPublicKey) || 0) - 1;
    const quorum = this.blockchain.getQuorum();
    if (credit > quorum * -0.5 && [...this.mapStakeCredit.values()].reduce((p, c) => p + c, 0) > quorum * -1) {
      this.mapModifyStake.set(k, command);
      this.mapStakeCredit.set(forPublicKey, credit);
    }

    //@TODO review
    // make sure that the timeout gets called, depending on the size of the network
    clearTimeout(this.timeoutModifyStake);
    this.timeoutModifyStake = setTimeout(() => {
      this.stackTx([...this.mapModifyStake.values()]);
      this.mapModifyStake = new Map();
    }, this.network.getArrayNetwork().length * this.config.network_p2p_interval_ms);
  }

  incStakeCredit(publicKey: string) {
    this.mapStakeCredit.set(publicKey, (this.mapStakeCredit.get(publicKey) || 0) + 1);
  }

  stackTx(commands: ArrayCommand, ident: string = '') {
    let s = 1;
    const i = this.blockFactory.stack(
      commands.map((c) => {
        c.seq = s;
        s++;
        return c;
      }),
      ident
    );
    if (!i) {
      return false;
    }
    return i;
  }

  feedBlock(block: BlockStruct) {
    setImmediate((block: BlockStruct) => {
      this.webSocketServerBlockFeed.clients.forEach(
        (ws) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(block))
      );
    }, block);
  }

  private static error(err: any, req: Request, res: Response, next: NextFunction) {
    res.status(err.status || 500);

    res.json({
      path: req.path,
      status: err.status || 500,
      message: err.message,
      error: process.env.NODE_ENV === 'development' ? err : {},
    });

    next();
  }
}
