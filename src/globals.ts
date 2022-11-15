export const ChainId = { MAINNET: 1, LOCAL: 1337, AVALANCHE: 43114 };

export const CONTRACTS_ADDRESSES = {
  poolAddress: '0xd4811d73938f131a6bf0e10ce281b05d6959fcbd',
  // todo: this is eth makerdao multicall address, might be wrong thing to use here
  // MulticallWithFailure: 'https://etherscan.io/address/0xeefba1e63905ef1d7acba5a8513c70307c1ce441#contracts',
  MulticallWithFailure: '0x77dCa2C955b15e9dE4dbBCf1246B4B85b651e50e', // gorli
  // NEWO: '0x98585dFc8d9e7D48F0b1aE47ce33332CF4237D96',
  NEWO: '0x92FedF27cFD1c72052d7Ca105A7F5522E4D7403D', // gorli
  veNEWO: '0x44dd83E0598e7A3709cF0b2e59D3319418068a65',
  // TODO
  NewoDistributor: '',
  MerkleRootDistributor: '',
};
