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

import { Message } from './message';
import { Util } from '../../chain/util';

export type VoteStruct = {
  type: number;
  origin: string;
  hash: string;
  sig: string;
};

export class Vote extends Message {
  constructor(message?: Buffer | string) {
    super(message);
    this.message.broadcast = true;
  }

  create(structVote: VoteStruct): Vote {
    this.message.ident = [structVote.type, structVote.sig].join();
    this.message.data = structVote;
    return this;
  }

  get(): VoteStruct {
    return this.message.data as VoteStruct;
  }

  static isValid(structVote: VoteStruct): boolean {
    return Util.verifySignature(structVote.origin, structVote.sig, structVote.hash);
  }
}
