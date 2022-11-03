Express server to compute weekly incentives for Uniswap V3 pools

## Setup

- Install dependencies by running `yarn`
- Fill `.env` following `.env.example`
- Launch the express server by running `nodemon src/index.ts`

## Usage

2 routes are currently built: `http://localhost:8080/polygon` and `http://localhost:8080/mainnet`

- Weekly distribution is split against every swap that happened proportionally to their volume

## How does it work

# Eligibility calculation

- LP directly provided on Uniswap through the `NonfungiblePositionManager`
- LP through Arrakis and hold Arrakis LP token
- LP through Arrakis and stake the Arrakis LP token on the Angle gauge (for backwards compatibility)
- LP through Gamma 3 once they have deployed the pool

# Rewards calculation

- For each swap, the rewards are split between all LPs position in range, proportionally to:
  - (0.4 _ (fees earned by the position) / (fees of the swap) + 0.4 _ (agEUR in the position) / (agEUR in the pool) + 0.2 _ (other token in the position) / (other token in the pool)) _ veANGLE boost

# Distribution

- Uses a standard `RewardDistributor` contract, sending rewards to the contract and allowing claiming through a merkle root

# Pros:

- Maximal flexibility on the DAO side: the distribution rules could be changed anytime
- Maximal flexibility on the LP side: they can choose their range or their management solution
- Optimized UX: as there would be no need to stake the Uni V3 position, it minimizes the number of on-chain txs
- Minimal Composability risk: as we don’t rely on any external party to stake the position, there is no risk of smart contract failure
- Current LPs would not have to do anything: we’ll include them in the computations so they don’t even have to unstake their position

# Cons:

- Requires trust in centralized party to compute and upload the merkle root
- Trust is relative as the party would only be able to steal one weekly distribution of NEWO

## Map

- `abis.ts` - stores the abis of each contract used
- `github.ts` - used for auto-uploading to github
- `index.ts` - todo
- `ipfs.ts` - doing stuff with ipfs
- `provider.ts` - todo
- `scripts.ts` - computes the uniswap v3 incentives
- `uniswap.ts` - todo
- `utils.ts` - todo
