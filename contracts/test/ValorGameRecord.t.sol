// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/ValorGameRecord.sol";

contract ValorGameRecordTest is Test {
    ValorGameRecord record;

    address owner = makeAddr("owner");
    address backend = makeAddr("backend");
    address player = makeAddr("player");

    function setUp() public {
        ValorGameRecord impl = new ValorGameRecord();
        record = ValorGameRecord(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(ValorGameRecord.initialize, (backend, owner))
        )));
    }

    function test_RecordVerificationEmitsEvent() public {
        vm.expectEmit(true, false, false, true, address(record));
        emit ValorGameRecord.VerificationRecorded(player, block.timestamp);
        vm.prank(backend);
        record.recordVerification(player);
    }

    function test_OnlyBackendCanRecordVerification() public {
        vm.prank(player);
        vm.expectRevert(ValorGameRecord.OnlyBackend.selector);
        record.recordVerification(player);
    }

    function test_RecordBattleStillWorks() public {
        vm.expectEmit(true, true, true, true, address(record));
        emit ValorGameRecord.BattleRecorded(bytes32(uint256(1)), player, address(0), 10, 0, true, block.timestamp);
        vm.prank(backend);
        record.recordBattle(bytes32(uint256(1)), player, address(0), 10, 0, true);
    }
}
