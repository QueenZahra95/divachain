"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Wallet = void 0;
const sodium_native_1 = __importDefault(require("sodium-native"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const rfc4648_1 = require("rfc4648");
const i2p_sam_1 = require("@diva.exchange/i2p-sam/dist/i2p-sam");
class Wallet {
    constructor(config) {
        this.ident = '';
        this.config = config;
        this.publicKey = Buffer.alloc(sodium_native_1.default.crypto_sign_PUBLICKEYBYTES);
        this.secretKey = sodium_native_1.default.sodium_malloc(sodium_native_1.default.crypto_sign_SECRETKEYBYTES);
    }
    static make(config) {
        return new Wallet(config);
    }
    open() {
        this.ident = (0, i2p_sam_1.toB32)(this.config.http) + '.wallet';
        sodium_native_1.default.sodium_mlock(this.secretKey);
        const pathPublic = path_1.default.join(this.config.path_keys, this.ident + '.public');
        const pathSecret = path_1.default.join(this.config.path_keys, this.ident + '.private');
        if (fs_1.default.existsSync(pathPublic) && fs_1.default.existsSync(pathSecret)) {
            this.publicKey.fill(fs_1.default.readFileSync(pathPublic));
            this.secretKey.fill(fs_1.default.readFileSync(pathSecret));
        }
        else {
            sodium_native_1.default.crypto_sign_keypair(this.publicKey, this.secretKey);
            fs_1.default.writeFileSync(pathPublic, this.publicKey, { mode: '0644' });
            fs_1.default.writeFileSync(pathSecret, this.secretKey, { mode: '0600' });
        }
        return this;
    }
    close() {
        sodium_native_1.default.sodium_munlock(this.secretKey);
    }
    sign(data) {
        if (!this.ident) {
            this.open();
        }
        const bufferSignature = Buffer.alloc(sodium_native_1.default.crypto_sign_BYTES);
        sodium_native_1.default.crypto_sign_detached(bufferSignature, Buffer.from(data), this.secretKey);
        return rfc4648_1.base64url.stringify(bufferSignature, { pad: false });
    }
    getPublicKey() {
        if (!this.ident) {
            this.open();
        }
        return rfc4648_1.base64url.stringify(this.publicKey, { pad: false });
    }
}
exports.Wallet = Wallet;
