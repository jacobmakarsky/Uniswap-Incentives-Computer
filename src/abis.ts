import { utils } from 'ethers';

export const multicallABI = [
  { inputs: [], name: 'SubcallFailed', type: 'error' },
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'target', type: 'address' },
          { internalType: 'bytes', name: 'data', type: 'bytes' },
          { internalType: 'bool', name: 'canFail', type: 'bool' },
        ],
        internalType: 'struct MultiCallWithFailure.Call[]',
        name: 'calls',
        type: 'tuple[]',
      },
    ],
    name: 'multiCall',
    outputs: [{ internalType: 'bytes[]', name: '', type: 'bytes[]' }],
    stateMutability: 'view',
    type: 'function',
  },
];

export const uniswapV3PoolABI = [
  'function positions(uint256) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
  'function ownerOf(uint256) external view returns(address)',
  'function token0() external view returns(address)',
  'function token1() external view returns(address)',
];

export const arrakisABI = [
  'function getUnderlyingBalances() external view returns(uint256 amount0Current, uint256 amount1Current)',
  'function positions(bytes32) external view returns(uint128, uint256, uint256, uint128, uint128)',
  'function lowerTick() external view returns(int24)',
  'function upperTick() external view returns(int24)',
  'function balanceOf(address) external view returns(uint256)',
];

export const gammaABI = [
  'function getBasePosition() external view returns(uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function getLimitPosition() external view returns(uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function baseLower() external view returns(int24)',
  'function baseUpper() external view returns(int24)',
  'function limitLower() external view returns(int24)',
  'function limitUpper() external view returns(int24)',
];

export const merkleDistributorABI = [
  'function updateTree((bytes32,bytes32)) external',
  'function tree() external view returns(bytes32,bytes32)',
];

export const uniswapV3Interface = new utils.Interface(uniswapV3PoolABI);
export const arrakisInterface = new utils.Interface(arrakisABI);
export const gammaInterface = new utils.Interface(gammaABI);
