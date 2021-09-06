/**
 * Copyright (C) 2021 diva.exchange
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
 * Author/Maintainer: Konrad Bächler <konrad@diva.exchange>
 */

import { suite, test, slow, timeout } from '@testdeck/mocha';
import chai, { expect } from 'chai';
import chaiHttp from 'chai-http';
import path from 'path';

import { NAME_HEADER_API_TOKEN } from '../../src/net/api';
import { Server } from '../../src/net/server';
import { Config } from '../../src/config';
import { BlockStruct } from '../../src/chain/block';
import { Blockchain } from '../../src/chain/blockchain';
import { CommandAddPeer, CommandModifyStake } from '../../src/chain/transaction';
import { Wallet } from '../../src/chain/wallet';
import fs from 'fs';

chai.use(chaiHttp);

const SIZE_TESTNET = 13;
const NETWORK_SIZE = 5;
const BASE_PORT = 17000;
const BASE_PORT_FEED = 18000;
const IP = '127.27.27.1';

@suite
class TestServer {
  static mapConfigServer: Map<string, Config> = new Map();
  static mapServer: Map<string, Server> = new Map();

  @timeout(20000)
  static before(): Promise<void> {
    // create a genesis block
    const genesis: BlockStruct = Blockchain.genesis(path.join(__dirname, '../../genesis/block.json'));

    const cmds: Array<CommandAddPeer | CommandModifyStake> = [];
    let s = 1;
    for (let i = 1; i <= SIZE_TESTNET; i++) {
      const config = new Config({
        no_bootstrapping: true,
        ip: IP,
        port: BASE_PORT + i,
        port_block_feed: BASE_PORT_FEED + i,
        path_genesis: path.join(__dirname, '../genesis/block.json'),
        path_state: path.join(__dirname, '../state'),
        path_blockstore: path.join(__dirname, '../blockstore'),
        path_keys: path.join(__dirname, '../keys'),
        network_size: NETWORK_SIZE,
        network_morph_interval_ms: 30000,
      });

      const publicKey = Wallet.make(config).getPublicKey();
      TestServer.mapConfigServer.set(publicKey, config);

      cmds.push({
        seq: s,
        command: 'addPeer',
        host: IP,
        port: BASE_PORT + i,
        publicKey: publicKey,
      } as CommandAddPeer);
      s++;
      cmds.push({
        seq: s,
        command: 'modifyStake',
        publicKey: publicKey,
        stake: Math.floor((Math.random() * 1000) / Math.sqrt(i)),
      } as CommandModifyStake);
      s++;
    }
    genesis.tx = [
      {
        ident: 'genesis',
        origin: '0000000000000000000000000000000000000000000',
        timestamp: 88355100000,
        commands: cmds,
        sig: '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      },
    ];
    fs.writeFileSync(path.join(__dirname, '../genesis/block.json'), JSON.stringify(genesis));

    return new Promise((resolve) => {
      setTimeout(resolve, 9000);

      for (const pk of TestServer.mapConfigServer.keys()) {
        (async () => {
          await TestServer.createServer(pk);
        })();
      }
    });
  }

  @timeout(60000)
  static after(): Promise<void> {
    return new Promise((resolve) => {
      let c = TestServer.mapServer.size;
      TestServer.mapServer.forEach(async (s) => {
        await s.shutdown();
        c--;
        if (!c) {
          setTimeout(resolve, 500);
        }
      });
    });
  }

  static async createServer(publicKey: string) {
    const s = new Server(
      new Config({
        ...TestServer.mapConfigServer.get(publicKey),
        ...{
          path_genesis: path.join(__dirname, '../genesis/block.json'),
          path_blockstore: path.join(__dirname, '../blockstore'),
          path_state: path.join(__dirname, '../state'),
          path_keys: path.join(__dirname, '../keys'),
        },
      })
    );
    await s.start();
    TestServer.mapServer.set(publicKey, s);
    return s;
  }

  @test
  async default404() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/');
    expect(res).to.have.status(404);
  }

  @test
  async transactionTestLoad() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const pathToken = path.join(config.path_keys, config.address.replace(/[^a-z0-9_-]+/gi, '-') + '.api-token');
    const token = fs.readFileSync(pathToken).toString();
    const res = await chai
      .request(`http://${config.ip}:${config.port}`)
      .put('/transaction')
      .set(NAME_HEADER_API_TOKEN, token)
      .send([{ seq: 1, command: 'data', ns: 'test', base64url: 'abcABC' }]);
    expect(res).to.have.status(200);
  }

  @test
  @slow(399000)
  @timeout(400000)
  async transactionFails() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai
      .request(`http://${config.ip}:${config.port}`)
      .put('/transaction')
      .send([{ seq: 1, command: 'testLoad', timestamp: Date.now() }]);
    expect(res).to.have.status(403);
  }

  @test
  async about() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/about');
    expect(res).to.have.status(200);
  }

  @test
  async peers() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/peers');
    expect(res).to.have.status(200);
  }

  @test
  async network() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/network');
    expect(res).to.have.status(200);
  }

  @test
  async gossip() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/gossip');
    expect(res).to.have.status(200);
  }

  @test
  async state() {
    const config = [...TestServer.mapConfigServer.values()][0];
    let res = await chai.request(`http://${config.ip}:${config.port}`).get('/state');
    expect(res).to.have.status(200);
    res = await chai.request(`http://${config.ip}:${config.port}`).get('/state/peer:invalid-key');
    expect(res).to.have.status(404);
    const _pk = [...TestServer.mapConfigServer.keys()][0];
    res = await chai.request(`http://${config.ip}:${config.port}`).get('/state/peer:' + _pk);
    expect(res).to.have.status(200);
  }

  @test
  async stackTransactions() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/stack/transactions');
    expect(res).to.have.status(200);
  }

  @test
  async poolTransactions() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/pool/transactions');
    expect(res).to.have.status(200);
  }

  @test
  async poolVotes() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/pool/votes');
    expect(res).to.have.status(200);
  }

  @test
  async poolCommits() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/pool/commits');
    expect(res).to.have.status(200);
  }

  @test
  async blocks() {
    const config = [...TestServer.mapConfigServer.values()][0];
    let res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/block/genesis');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/block/latest');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks?limit=1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks?gte=1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks?lte=1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks?gte=-1&lte=1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks?gte=1&lte=-1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks?gte=1&lte=2');
    expect(res).to.have.status(200);
  }

  @test
  async page() {
    const config = [...TestServer.mapConfigServer.values()][0];
    let res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks/page/1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks/page/1?size=1');
    expect(res).to.have.status(200);
  }

  @test
  async injectObjectAsTransaction() {
    const arrayConfig = [...TestServer.mapConfigServer.values()];
    console.log(`http://${arrayConfig[0].ip}:${arrayConfig[0].port}`);
    const res = await chai
      .request(`http://${arrayConfig[0].ip}:${arrayConfig[0].port}`)
      .put('/transaction')
      .send({ seq: 1, command: 'data', ns: 'test', base64url: 'bogus' });

    expect(res.status).eq(403);
  }

  @test
  @slow(10000000)
  @timeout(10000000)
  async stressMultiTransaction() {
    const _outer = 500;
    const _inner = 5;

    // create blocks containing multiple transactions
    let seq = 1;
    const arrayConfig = [...TestServer.mapConfigServer.values()];
    const arrayOrigin = [...TestServer.mapConfigServer.keys()];
    const arrayRequests: Array<string> = [];
    const arrayIdents: Array<string> = [];
    const arrayTimestamp: Array<number> = [];

    // kill the last 20% of the servers after 60 seconds
    setTimeout(async () => {
      const _arrayPK = [...TestServer.mapConfigServer.keys()];
      for (let _i = 0; _i < Math.ceil(_arrayPK.length / 5); _i++) {
        const _pk = _arrayPK.pop() || '';
        console.log(`Killing Server: ${_pk}`);
        arrayConfig.pop();
        arrayOrigin.pop();
        const s = TestServer.mapServer.get(_pk);
        s && (await s.shutdown());
      }
    }, 60000);

    // wait, 20s to make sure the network gets into morphing while stress tested
    console.log('waiting 20s to get network settled...');
    await TestServer.wait(20000);

    for (let _i = 0; _i < _outer; _i++) {
      const aT: Array<any> = [];
      for (let _j = 0; _j < _inner; _j++) {
        aT.push({ seq: seq++, command: 'data', ns: 'test', base64url: Date.now().toString() });
      }
      const i = Math.floor(Math.random() * (arrayConfig.length - 1));

      try {
        console.log(`${_i}: http://${arrayConfig[i].ip}:${arrayConfig[i].port}`);
        const res = await chai
          .request(`http://${arrayConfig[i].ip}:${arrayConfig[i].port}`)
          .put('/transaction')
          .send(aT);
        arrayTimestamp.push(new Date().getTime());
        arrayRequests.push(arrayOrigin[i]);
        arrayIdents.push(res.body.ident);
      } catch (error: any) {}
      await TestServer.wait(1 + Math.floor(Math.random() * 500));
    }

    console.log('waiting for sync');
    // wait for a possible sync
    await TestServer.wait(60000);

    let x = 0;
    while (arrayRequests.length) {
      const origin = arrayRequests.shift();
      const ident = arrayIdents.shift();
      const i = Math.floor(Math.random() * (arrayConfig.length - 1));
      const baseUrl = `http://${arrayConfig[i].ip}:${arrayConfig[i].port}`;
      const res = await chai.request(baseUrl).get(`/transaction/${origin}/${ident}`);
      if (res.status === 200) {
        const perf = await chai.request(baseUrl).get(`/debug/performance/${res.body.height}`);
        const ts = arrayTimestamp.shift() || 0;
        console.log(
          perf.body.timestamp
            ? `${x}: ${perf.body.timestamp - ts}  ms`
            : `No performance data for block ${res.body.height}`
        );
      } else {
        console.error(`Request ${x} not found`);
      }
      x++;
    }

    // all blockchains have to be equal
    const arrayBlocks: Array<any> = [];
    for (const config of arrayConfig) {
      const res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks?limit=1');
      arrayBlocks.push(res.body);
    }
    const _h = arrayBlocks[0][0].hash;
    arrayBlocks.forEach((_a) => {
      expect(_h).eq(_a[0].hash);
    });
  }

  private static async wait(s: number) {
    // wait a bit
    await new Promise((resolve) => {
      setTimeout(resolve, s, true);
    });
  }
}
