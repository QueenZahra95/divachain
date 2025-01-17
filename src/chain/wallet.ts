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

import sodium from 'sodium-native';
import fs from 'fs';
import path from 'path';
import { Config } from '../config';
import { base64url } from 'rfc4648';
import { toB32 } from '@diva.exchange/i2p-sam/dist/i2p-sam';

export class Wallet {
  private config: Config;
  private ident: string = '';
  private readonly publicKey: Buffer;
  private readonly secretKey: Buffer;

  static make(config: Config): Wallet {
    return new Wallet(config);
  }

  private constructor(config: Config) {
    this.config = config;
    this.publicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
    this.secretKey = sodium.sodium_malloc(sodium.crypto_sign_SECRETKEYBYTES);
  }

  open(): Wallet {
    this.ident = toB32(this.config.http) + '.wallet';

    sodium.sodium_mlock(this.secretKey);

    // look for keys
    const pathPublic = path.join(this.config.path_keys, this.ident + '.public');
    const pathSecret = path.join(this.config.path_keys, this.ident + '.private');
    if (fs.existsSync(pathPublic) && fs.existsSync(pathSecret)) {
      this.publicKey.fill(fs.readFileSync(pathPublic));
      this.secretKey.fill(fs.readFileSync(pathSecret));
    } else {
      sodium.crypto_sign_keypair(this.publicKey, this.secretKey);

      fs.writeFileSync(pathPublic, this.publicKey, { mode: '0644' });
      fs.writeFileSync(pathSecret, this.secretKey, { mode: '0600' });
    }

    return this;
  }

  close() {
    sodium.sodium_munlock(this.secretKey);
  }

  sign(data: string): string {
    if (!this.ident) {
      this.open();
    }

    const bufferSignature: Buffer = Buffer.alloc(sodium.crypto_sign_BYTES);
    sodium.crypto_sign_detached(bufferSignature, Buffer.from(data), this.secretKey);

    return base64url.stringify(bufferSignature, { pad: false });
  }

  getPublicKey(): string {
    if (!this.ident) {
      this.open();
    }
    return base64url.stringify(this.publicKey, { pad: false });
  }
}
