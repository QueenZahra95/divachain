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

import { Wallet } from './wallet';
import { nanoid } from 'nanoid';

const MAX_LENGTH_IDENT = 32;

interface Command {
  seq: number;
  command: string;
}

interface CommandTestLoad extends Command {
  timestamp: number;
}

export interface CommandAddPeer extends Command {
  host: string;
  port: number;
  publicKey: string;
}

export interface CommandRemovePeer extends Command {
  publicKey: string;
}

export interface CommandModifyStake extends Command {
  publicKey: string;
  stake: number;
}

export type ArrayComand = Array<CommandTestLoad | CommandAddPeer | CommandRemovePeer | CommandModifyStake>;

export type TransactionStruct = {
  ident: string;
  origin: string;
  timestamp: number; // Format: Milliseconds (1/1,000 second)
  commands: ArrayComand;
  sig: string;
};

export class Transaction {
  private readonly structTransaction: TransactionStruct;

  constructor(wallet: Wallet, commands: ArrayComand, ident: string = '') {
    const _ident = ident.length > 0 && ident.length <= MAX_LENGTH_IDENT ? ident : nanoid(8);
    const _ts = Date.now();
    this.structTransaction = {
      ident: _ident,
      origin: wallet.getPublicKey(),
      timestamp: _ts,
      commands: commands,
      sig: wallet.sign(_ident + _ts + JSON.stringify(commands)),
    };
  }

  get(): TransactionStruct {
    return this.structTransaction;
  }
}
