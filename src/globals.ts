export const ChainId = { MAINNET: 1, GOERLI: 5, LOCAL: 1337 };

// mainnet and testnet
export const CONTRACTS_ADDRESSES =
  process.env.PRODUCTION_SETUP === 'true'
    ? {
        poolAddress: '0xd4811d73938f131a6bf0e10ce281b05d6959fcbd',
        // MulticallWithFailure: 'https://etherscan.io/address/0xeefba1e63905ef1d7acba5a8513c70307c1ce441#contracts',
        MulticallWithFailure: '0xBA22FA85650735f9cF097AD1bd935875348a0A64', // gorli
        NEWO: '0x98585dFc8d9e7D48F0b1aE47ce33332CF4237D96',
        veNEWO: '0x44dd83E0598e7A3709cF0b2e59D3319418068a65',
        MerkleRootDistributor: '0xa52cC093cA3DdF7a91575569CE9f672EC02B2CDe',
        NewoDistributor: '0x1a82b680B47919Fd0c4B945F9d492A8688EE8933',
        // NewoDistributor: '0x1a82b680B47919Fd0c4B945F9d492A8688EE8933', // mainnet
      }
    : {
        poolAddress: '0x88e9cc9e44996db3ea0ef66b2a2a8998852f8c45',
        MulticallWithFailure: '0xBA22FA85650735f9cF097AD1bd935875348a0A64',
        // NEWO: '0x92FedF27cFD1c72052d7Ca105A7F5522E4D7403D', // gorli old
        NEWO: '0x26cf02313b86d531D66698b64fD78795aFa6E9b8',
        // veNEWO: '0x3e0B3A5e3659CeAEEB8d6Dd190E7CBc0fCD749c4', // gorli old
        veNEWO: '0x035C1d60472133270A9208fbB9aB2E906B604C76',
        MerkleRootDistributor: '0xa52cC093cA3DdF7a91575569CE9f672EC02B2CDe',
        NewoDistributor: '0x1a82b680B47919Fd0c4B945F9d492A8688EE8933',
      };
