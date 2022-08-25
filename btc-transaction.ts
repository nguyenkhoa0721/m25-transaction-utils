import BN from 'bn.js';
import secp256k1 from 'secp256k1';

import {
    readUInt64,
    p2pkhScriptSig,
    p2wpkhScriptSig,
    fromBase58Check,
    encodeSig,
    sha256,
    hash160,
    generateScript,
    bach32Decode,
    p2pkhScript,
} from './btc-script';

import { checkAddressType } from './btc-address-type';
import { off } from 'process';
export class RawTransaction {
    _tx: any;
    _isSegwit: boolean = false;
    constructor(isSegwit: boolean = false) {
        this._isSegwit = isSegwit;
        if (!this._isSegwit) {
            this._tx = { version: 2, locktime: 0, vins: [], vouts: [], txType: 'p2pkh' };
        } else if (this._isSegwit) {
            this._tx = { version: 2, flag: 1, locktime: 0, vins: [], vouts: [], txType: 'p2wpkh' };
        } else {
            throw new Error('Transaction type is not supported');
        }
    }
    /*
    @param  
        {string} address - The address to send to.
        {number} amount - The amount to send.
        {string} txid - The transaction id of the previous transaction.
    @description 
        Adds a vin to the transaction.
    */
    addInput(address: string, txid: string, vout: number, amount: string = '0') {
        const addressType = checkAddressType(address);
        const hash = new Buffer(txid, 'hex').reverse().toString('hex');
        const script = generateScript(addressType, address).toString('hex');

        this._tx.vins.push({
            txid,
            vout,
            hash,
            sequence: 0xffffffff,
            script,
            address,
            value: amount,
            scriptSig: '',
            addressType,
            witness: '',
        });
    }
    /*
    @param
        {string} address - The address to send to.
        {number} amount - The amount to send.
    @description
        Adds a vout to the transaction.
    */
    addOutput(address: string, amount: string) {
        const addressType = checkAddressType(address);
        const script = generateScript(addressType, address).toString('hex');

        this._tx.vouts.push({
            address,
            script,
            value: amount,
            addressType,
        });
    }
    /*
    @description
        Returns the transaction in JSON format.
    */
    toJSON() {
        return JSON.parse(JSON.stringify(this._tx));
    }
    /*
    @description
        Returns the transaction in hex format.
    */
    toHex(option: any): string {
        let buffer = Buffer.alloc(1000);
        let offset = 0;
        let numberOfWitnesses = 0;
        //version
        buffer.writeUInt32LE(this._tx.version, offset);
        offset += 4;
        //flag
        if (this._isSegwit) {
            buffer.writeUInt16BE(this._tx.flag, offset);
            offset += 2;
        }
        //vin len
        buffer.writeUInt16LE(this._tx.vins.length, offset);
        offset += 1;
        for (let i in this._tx.vins) {
            let input = this._tx.vins[i];
            //txid
            buffer.write(input.hash, offset, 32, 'hex');
            offset += 32;
            //vout
            buffer.writeUInt32LE(input.vout, offset);
            offset += 4;
            //script len & script
            buffer.writeUInt16LE(input.scriptSig.length / 2, offset);
            offset += 1;
            if (input.scriptSig.length > 0) {
                buffer.write(input.scriptSig, offset, input.scriptSig.length / 2, 'hex');
                offset += input.scriptSig.length / 2;
            }
            buffer.writeUInt32LE(input.sequence, offset);
            offset += 4;
        }
        //vout len
        buffer.writeUInt16LE(this._tx.vouts.length, offset);
        offset += 1;
        for (let i in this._tx.vouts) {
            let output = this._tx.vouts[i];
            //amount
            let BNValue = new BN(output.value);
            buffer.write(BNValue.toBuffer('le', 8).toString('hex'), offset, 8, 'hex');
            offset += 8;
            //script len & script
            buffer.writeUInt16LE(output.script.length / 2, offset);
            offset += 1;
            buffer.write(output.script, offset, output.script.length / 2, 'hex');
            offset += output.script.length / 2;
        }
        //witnesses
        if (this._isSegwit) {
            buffer.writeUInt16LE(this._tx.vins.length * 2, offset);
            offset += 1;
            for (let i in this._tx.vins) {
                let input = this._tx.vins[i];
                buffer.write(input.witness, offset, input.witness.length / 2, 'hex');
                offset += input.witness.length / 2;
            }
        }
        //locktime
        buffer.writeUInt16LE(this._tx.locktime, offset);
        offset += 4;

        if (offset < buffer.length) {
            buffer = buffer.slice(0, offset);
        }

        return buffer.toString('hex');
    }
    toSignHex(vindex: number): string {
        const signTx = new RawTransaction();
        signTx.deepCopy(this);
        for (let i = 0; i < signTx._tx.vins.length; i++) {
            if (i == vindex) signTx._tx.vins[i].scriptSig = signTx._tx.vins[i].script;
            else signTx._tx.vins[i].scriptSig = '';
        }
        return signTx.toHex(signTx._tx.vins[vindex].addressType);
    }
    toSegwitSignHex(vindex: number): string {
        const signTx = new RawTransaction();
        signTx.deepCopy(this);
        let buffer = Buffer.alloc(1000);
        let inputBuffer = Buffer.alloc(signTx._tx.vins.length * (32 + 4)); //txid + vout
        let sequenceBuffer = Buffer.alloc(signTx._tx.vins.length * 4); //sequence
        let specificInputBuffer = Buffer.alloc(32 + 4); //txid + vout
        let scriptBuffer: Buffer; //script len
        let outputBuffer = Buffer.alloc(1000);

        let offsetInputBuffer = 0;
        let offsetSequenceBuffer = 0;
        for (let i = 0; i < signTx._tx.vins.length; i++) {
            const input = signTx._tx.vins[i];
            inputBuffer.write(input.hash, offsetInputBuffer, 32, 'hex');
            offsetInputBuffer += 32;
            inputBuffer.writeUInt32LE(input.vout, offsetInputBuffer);
            offsetInputBuffer += 4;

            sequenceBuffer.writeUInt32LE(input.sequence, offsetSequenceBuffer);
            offsetSequenceBuffer += 4;
        }

        specificInputBuffer.write(signTx._tx.vins[vindex].hash, 0, 32, 'hex');
        specificInputBuffer.writeUInt32LE(signTx._tx.vins[vindex].vout, 32);
        if (signTx._tx.vins[vindex].addressType == 'p2wpkh') {
            const script = p2pkhScript(bach32Decode(signTx._tx.vins[vindex].address));
            scriptBuffer = Buffer.alloc(script.length + 1); //script len + script
            scriptBuffer.writeUInt16LE(script.length, 0);
            scriptBuffer = Buffer.concat([scriptBuffer.slice(0, 1), script]);
            console.log(scriptBuffer.toString('hex'));
        } else {
            throw new Error(
                'Generate sign hash: Unsupported address type for creating script code'
            );
        }
        specificInputBuffer = Buffer.concat([specificInputBuffer, scriptBuffer]);
        let specificSequenceBuffer = Buffer.alloc(4);
        specificSequenceBuffer.writeUInt32LE(signTx._tx.vins[vindex].sequence, 0);
        specificInputBuffer = Buffer.concat([
            specificInputBuffer,
            new BN(signTx._tx.vins[vindex].value).toBuffer('le', 8),
            specificSequenceBuffer,
        ]);

        let offsetOutputBuffer = 0;
        for (let i = 0; i < signTx._tx.vouts.length; i++) {
            const output = signTx._tx.vouts[i];
            outputBuffer.write(
                new BN(output.value).toBuffer('le', 8).toString('hex'),
                offsetOutputBuffer,
                8,
                'hex'
            );
            offsetOutputBuffer += 8;
            outputBuffer.writeUInt16LE(output.script.length / 2, offsetOutputBuffer);
            offsetOutputBuffer += 1;
            if (output.script.length > 0) {
                outputBuffer.write(
                    output.script,
                    offsetOutputBuffer,
                    output.script.length / 2,
                    'hex'
                );
                offsetOutputBuffer += output.script.length / 2;
            }
        }
        outputBuffer = outputBuffer.slice(0, offsetOutputBuffer);
        let offset = 0;
        //version
        buffer.writeUInt32LE(signTx._tx.version, offset);
        offset += 4;
        //double hash input
        inputBuffer = sha256(sha256(inputBuffer));
        //double hash sequence
        sequenceBuffer = sha256(sha256(sequenceBuffer));
        //double hash output
        outputBuffer = sha256(sha256(outputBuffer));

        buffer = Buffer.concat([
            buffer.slice(0, offset),
            inputBuffer,
            sequenceBuffer,
            specificInputBuffer,
            outputBuffer,
            Buffer.alloc(4), //locktime
        ]);
        offset +=
            inputBuffer.length +
            sequenceBuffer.length +
            specificInputBuffer.length +
            outputBuffer.length;

        buffer.writeUInt16LE(signTx._tx.locktime, offset);
        offset += 4;

        buffer = buffer.slice(0, offset);
        return buffer.toString('hex');
    }
    /*
    @param
        {string} privKey - The private key to sign with.
    @description
        Signs the transaction with the private key.
        For every input, the scriptSig is set to the sign 
        script generated by the private key and the other 
        vindices are set to empty. Script field will be 
        set temporarily to scriptSig.
        After all inputs are signed, scriptSig field is set 
        to the scipt field
    */
    async sign(privKey: any, inputs: number[]): Promise<any> {
        privKey = Uint8Array.from(Buffer.from(privKey, 'hex'));
        let pubKey = secp256k1.publicKeyCreate(privKey, false);
        let compressedPubKey = secp256k1.publicKeyConvert(pubKey, true);

        for (let i of inputs) {
            let sigHash = await this.createSigHash(i, 1);
            let sig = secp256k1.ecdsaSign(sigHash, privKey);
            let encSig = encodeSig(Buffer.from(sig.signature), 1);
            if (this._tx.vins[i].addressType == 'p2wpkh') {
                this._tx.vins[i].witness = p2pkhScriptSig(
                    encSig,
                    Buffer.from(compressedPubKey)
                ).toString('hex');
            } else if (this._tx.vins[i].addressType == 'p2pkh') {
                this._tx.vins[i].scriptSig = p2pkhScriptSig(encSig, Buffer.from(pubKey)).toString(
                    'hex'
                );
            }
        }
    }
    async createSigHash(vindex: number, hashType: number): Promise<any> {
        let txHex: Buffer;
        if (this._tx.vins[vindex].addressType == 'p2pkh') {
            txHex = Buffer.from(this.toSignHex(vindex), 'hex');
        } else if (this._tx.vins[vindex].addressType == 'p2wpkh') {
            txHex = Buffer.from(this.toSegwitSignHex(vindex), 'hex');
        } else {
            throw new Error('Create Sig hash: Unsupported address type');
        }
        let txHexHash = Buffer.alloc(txHex.length + 4, txHex);
        txHexHash.writeUInt32LE(hashType, txHexHash.length - 4);
        console.log('txHex', txHexHash.toString('hex'));
        return sha256(sha256(txHexHash));
    }
    deepCopy(tx: RawTransaction) {
        this._tx = tx.toJSON();
    }
    genHashId(): string {
        const tx = new RawTransaction();
        tx.deepCopy(this);
        for (let i in tx._tx.vins) {
            tx._tx.vins[i].scriptSig = '';
        }

        const hash = hash160(tx.toHex({}));
        return hash.toString('hex');
    }
}

async function test() {
    const hash160Script = fromBase58Check('2N4yEhDwic9Tm4BRN9EP1hnSu9f6cWJrU31').hash;
    console.log(hash160Script);
    let tx = new RawTransaction(true);
    tx.addInput(
        'mxFEHeSxxKjy9YcmFzXNpuE3FFJyby56jA',
        'd1a92ad68a031c5324981aa920152bd16975686905db41e3fc9d51c7ff4a20ed',
        1
    );
    tx.addInput(
        'tb1qt9xzu0df95vsfal8eptzyruv4e00k4ty6d8zhh',
        'b7203bd59b3c26c65699251939e1e6353f5f09952156c5b9c01bbe9f5372b89c',
        1,
        '9300'
    );
    tx.addInput(
        '2N4yEhDwic9Tm4BRN9EP1hnSu9f6cWJrU31',
        '04d984cdcf728975c173c45c49a242cedee2da5dc200b2f83ca6a98aecf11280',
        1
    );
    tx.addOutput('tb1qeds7u3tgpqkttxkzdwukaj8muqgf5nqq6w05ak', '16089269');
    await tx.sign('DBFF11E0F2F1AA5089465A591C5E523D1CA92668DED893155CDFABC94CC14E30', [0]);
    await tx.sign('26F85CE8B2C635AD92F6148E4443FE415F512F3F29F44AB0E2CBDA819295BBD5', [1]);
    await tx.sign('D9172189D7700FDFB4B6A5C4A83990EAEAFE455441B7D43FF85678EB93AC2713', [2]);
    console.log(tx.toJSON());
    // console.log(tx.toHex());
}

test();
