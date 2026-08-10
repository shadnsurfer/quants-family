/** WETH wrap/unwrap calldata builders — pure, deterministic, golden-testable. */
import { encodeFunctionData, parseEther, type Hex } from "viem";

const WETH_ABI = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  {
    type: "function", name: "withdraw", stateMutability: "nonpayable",
    inputs: [{ name: "wad", type: "uint256" }], outputs: [],
  },
] as const;

export function encodeWethDeposit(): Hex {
  return encodeFunctionData({ abi: WETH_ABI, functionName: "deposit" });
}

export function encodeWethWithdraw(amountEth: number | string): Hex {
  return encodeFunctionData({
    abi: WETH_ABI,
    functionName: "withdraw",
    args: [parseEther(String(amountEth))],
  });
}
