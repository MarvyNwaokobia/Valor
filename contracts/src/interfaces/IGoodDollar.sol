// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IGoodDollar {
    function transferAndCall(address to, uint256 value, bytes calldata data) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
