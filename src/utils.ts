import 'dotenv/config';

import axios from 'axios';
import { BigNumber, BigNumberish, Contract, ethers, utils } from 'ethers';
import { formatUnits } from 'ethers/lib/utils';
import keccak256 from 'keccak256';
import { MerkleTree } from 'merkletreejs';
import moment from 'moment';

import { merkleDistributorABI } from './abis';
import { CONTRACTS_ADDRESSES } from './globals';
import { getBytes32FromIpfsHash, uploadJSONToIPFS } from './ipfs';
import { httpProvider } from './provider';

export function BN2Number(bn: BigNumberish, base = 18) {
  return parseFloat(formatUnits(bn, base));
}

export type RewardType = { [holder: string]: { [label: string]: string } };

const number2string = (n: number): string => {
  if (n) {
    return BigNumber.from(Math.floor(n * 10 ** 10))
      .mul(BigNumber.from(10).pow(8))
      .toString();
  } else {
    return '';
  }
};

export const updateRewards = (rewards: RewardType, newRewards: { [holder: string]: number }, gaugeName: string) => {
  console.log('Updating rewards...');
  console.log('-----');

  // for every holder of new rewards
  for (const holder of Object.keys(newRewards)) {
    // if no existing? rewards reset to nothing i think
    if (!rewards[holder]) rewards[holder] = {};
    // set holders rewards of the pool to newrewards
    rewards[utils.getAddress(holder)][gaugeName] = number2string(newRewards[holder]);
  }
};

export const fetchRewards = async (chainId: any, weekId: number) => {
  console.log('Fetching rewards from github...');
  console.log('-----');

  let oldRewards: RewardType = {};
  while (Object.keys(oldRewards).length === 0) {
    try {
      oldRewards = (
        await axios.get<{ [address: string]: { [gauge: string]: string } }>(
          `https://github.com/jacobmakarsky/uniswapv3-rewards/${`mainnet` + `/rewards_` + weekId?.toString() + `.json`}`,
          {
            timeout: 5000,
          }
        )
      ).data;
    } catch {
      console.log('❌ Could not fetch rewards from week', weekId);
    }
  }

  return oldRewards;
};

// not used anywhere
export const logRewards = (rewards: RewardType) => {
  let sum = BigNumber.from(0);
  for (const key of Object.keys(rewards)) {
    for (const pool of Object.keys(rewards[key])) {
      console.log(key, pool, BN2Number(rewards[key][pool]));
      sum = sum.add(rewards[key][pool]);
    }
  }
  console.log(`Sum of all rewards distributed ${BN2Number(sum)}`);
};

export const addLastWeekRewards = async (rewards: RewardType, chainId: number) => {
  console.log('Adding last weeks rewards...');
  let oldRewards: RewardType = {};
  while (Object.keys(oldRewards).length === 0) {
    const weekId = Math.floor(moment().unix() / (7 * 86400)) - 1;
    try {
      oldRewards = (
        await axios.get<{ [address: string]: { [gauge: string]: string } }>(
          `https://github.com/jacobmakarsky/uniswapv3-rewards/${`mainnet` + `/rewards_` + weekId?.toString() + `.json`}`,
          {
            timeout: 5000,
          }
        )
      ).data;
    } catch {
      console.log('❌ Could not fetch rewards from week', weekId);
    }
  }

  for (const holder of Object.keys(oldRewards)) {
    if (!rewards[holder]) rewards[holder] = {};
    for (const pool of Object.keys(oldRewards[holder])) {
      const aux = BigNumber.from(!rewards[holder][pool] ? '0' : rewards[holder][pool]);
      rewards[holder][pool] = aux.add(oldRewards[holder][pool]).toString();
    }
  }

  console.log('-----');
};

export const uploadAndPush = async (rewards: RewardType, chainId: number) => {
  console.log('Uploading merkle root to distributor contract...');
  console.log('-----');

  const keeper = new ethers.Wallet(process.env.PRIVATE_KEY_UNISWAP_INCENTIVES as string, httpProvider(chainId));
  const merkleRootDistributor = new Contract(CONTRACTS_ADDRESSES.MerkleRootDistributor as string, merkleDistributorABI, keeper);

  const elements: string[] = [];
  const keys = Object.keys(rewards);

  for (const key in keys) {
    let sum = BigNumber.from(0);

    for (const pool of Object.keys(rewards[keys[key]])) {
      sum = sum.add(rewards[keys[key]][pool]);
    }

    const hash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(['address', 'address', 'uint256'], [utils.getAddress(keys[key]), CONTRACTS_ADDRESSES.NEWO, sum])
    );
    elements.push(hash);
  }

  const merkleTree = new MerkleTree(elements, keccak256, { hashLeaves: false, sortPairs: true });
  console.log('Merkle tree generated: ');
  console.log(merkleTree.toString());

  // upload to IPFS
  const ipfsHash = (await uploadJSONToIPFS(rewards)) as string;
  const ipfsBytes = getBytes32FromIpfsHash(ipfsHash);

  let sum = BigNumber.from(0);
  for (const key of Object.keys(rewards)) {
    for (const pool of Object.keys(rewards[key])) {
      sum = sum.add(rewards[key][pool]);
    }
  }

  // add to trusted addresses
  // const addAddress = await merkleRootDistributor.connect(keeper).toggleTrusted(keeper.address);
  // await addAddress.wait();

  // upload root and ipfs to distributor contract
  await merkleRootDistributor.connect(keeper).updateTree([merkleTree.getHexRoot(), ipfsBytes], { gasLimit: 1000000 });
  // const merkle = await merkleRootDistributor.connect(keeper).updateTree([merkleTree.getHexRoot()], { gasLimit: 1000000 });
  // must be in this [] format cuz of the way getHexRoot returns
  console.log('-----');
};
