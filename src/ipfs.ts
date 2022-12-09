import pinataSDK from '@pinata/sdk';
import axios from 'axios';
import { base58 } from 'ethers/lib/utils';
import { CID } from 'multiformats';
import { base58btc } from 'multiformats/bases/base58';
import { Blob, File, Web3Storage } from 'web3.storage';

// ============================= UTILITIES FOR IPFS ============================

// Return bytes32 hex string from base58 encoded ipfs hash,
// stripping leading 2 bytes from 34 byte IPFS hash
// Assume IPFS defaults: function:0x12=sha2, size:0x20=256 bits
// E.g. "QmNSUYVKDSvPUnRLKmuxk9diJ6yS96r1TrAXzjTiBcCLAL" -->
// "0x017dfd85d4f6cb4dcd715a88101f7b1f06cd1e009b2327a0809d01eb9c91f231"

export function getBytes32FromIpfsHash(ipfsListing: string) {
  let result = '0x';
  const array = base58.decode(ipfsListing).slice(2);

  for (const n of array) {
    let aux = n.toString(16);
    if (aux.length === 0) {
      aux = '00';
    } else if (aux.length === 1) {
      aux = '0' + aux;
    }
    result = result + aux;
  }
  return result;
}

// Return base58 encoded ipfs hash from bytes32 hex string,
// E.g. "0x017dfd85d4f6cb4dcd715a88101f7b1f06cd1e009b2327a0809d01eb9c91f231"
// --> "QmNSUYVKDSvPUnRLKmuxk9diJ6yS96r1TrAXzjTiBcCLAL"

export function getIpfsHashFromBytes32(bytes32Hex: string) {
  // Add our default ipfs values for first 2 bytes:
  // function:0x12=sha2, size:0x20=256 bits
  // and cut off leading "0x"
  const hashHex = '1220' + bytes32Hex.slice(2);
  const hashBytes = Buffer.from(hashHex, 'hex');
  const hashStr = base58.encode(hashBytes);
  return hashStr;
}

export async function uploadJSONToIPFS(json: Record<string, any>): Promise<string | undefined> {
  const cid = await uploadPinata(json);
  console.log('JSON uploaded to IPFS with id: ', cid);

  if (cid) {
    await pinWeb3Storage(cid);
    console.log('pinned web3.storage');
    await pinStarton(cid);
    console.log('pinned starton');
  }
  return cid;
}

async function uploadPinata(json: Record<string, any>) {
  const pinata = pinataSDK(process.env.PINATA_KEY as string, process.env.PINATA_SECRET as string);

  try {
    const result = await pinata.pinJSONToIPFS(json, {
      pinataMetadata: {
        name: 'UniV3 Incentives',
        description: 'UniV3 Incentives merkle tree',
      },
      pinataOptions: {
        cidVersion: 0,
      },
    });
    return result.IpfsHash;
  } catch (err) {
    console.log(err);
  }
}

// todo not being used right now
async function uploadWeb3Storage(json: Record<string, any>) {
  const client = new Web3Storage({ token: process.env.WEB3_STORAGE_TOKEN as string });
  const blob = new Blob([JSON.stringify(json)], { type: 'application/json' });
  const files = [new File([blob], 'uni-incentives.json')];
  const cid = await client.put(files, { wrapWithDirectory: false, name: 'ok' });
  return CID.parse(cid).toString(base58btc.encoder);
}

async function pinWeb3Storage(cid: string) {
  try {
    await axios.post(
      'https://api.web3.storage/pins',
      {
        name: 'uni-incentives',
        cid,
      },
      {
        headers: {
          Accept: '*/*',
          Authorization: `Bearer ${process.env.WEB3_STORAGE_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (e) {
    console.log('Failed to pin on web3.storage', e);
  }
}

async function pinStarton(cid: string) {
  try {
    await axios.post(
      'https://api.starton.io/v2/pinning/pins',
      {
        name: 'uni-incentives',
        cid,
      },
      {
        headers: {
          'x-api-key': process.env.STARTON_API_KEY as string,
        },
      }
    );
  } catch (e) {
    console.log('Failed to pin on Starton', e);
  }
}
