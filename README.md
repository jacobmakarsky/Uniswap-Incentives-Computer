![Logo](https://neworder.network/assets/images/logo.png)

# NEWO UniswapV3 Incentives Computer

## Setup

- Install dependencies by running `yarn`
- Fill `.env` following `.env.example`
- Launch the express server by running `yarn run run`

## Usage

Go to `http://localhost:8080/mainnet` in browser

- Weekly distribution is split against every swap that happened proportionally to their volume

To test on Göerli:

- see the [newo-testnet](https://github.com/new-order-network/newo-testnet) repo

# How does it work

## Eligibility calculation

- LP directly provided on Uniswap through the `NonfungiblePositionManager`

## Rewards calculation

- For each swap, the rewards are split between all LPs position in range, proportionally to:
  - (0.4 _ (fees earned by the position) / (fees of the swap) + 0.4 _ (NEWO in the position) / (NEWO in the pool) + 0.2 _ (other token in the position) / (other token in the pool)) _ veNEWO boost

## Distribution

- Uses a standard `RewardDistributor` contract, sending rewards to the contract and allowing claiming through a merkle root

## Map

- `abis.ts` - stores the abis of each contract used
- `github.ts` - used for auto-uploading to github
- `index.ts` - todo
- `ipfs.ts` - doing stuff with ipfs
- `provider.ts` - todo
- `scripts.ts` - computes the uniswap v3 incentives
- `uniswap.ts` - todo
- `utils.ts` - todo
