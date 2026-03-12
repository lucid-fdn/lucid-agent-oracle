// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/LucidOracle.sol";

contract LucidOracleTest is Test {
    LucidOracle oracle;
    address authority = address(this);
    address nonAuthority = address(0xBEEF);
    bytes16 constant AEGDP = bytes16("aegdp");
    bytes16 constant AAI = bytes16("aai");

    function setUp() public {
        oracle = new LucidOracle(authority);
    }

    // --- postReport ---

    // All timestamps are milliseconds since epoch (matching TypeScript Date.getTime())

    function test_postReport_stores_and_emits() public {
        vm.expectEmit(true, false, false, true);
        emit LucidOracle.ReportPosted(AEGDP, 847_000_000_000, 1_710_288_000_000, 9700);

        oracle.postReport(
            AEGDP, 847_000_000_000, 6, 9700, 0, 1_710_288_000_000,
            bytes32(uint256(0xabc)), bytes32(uint256(0xdef))
        );

        LucidOracle.Report memory r = oracle.getLatestReport(AEGDP);
        assertEq(r.value, 847_000_000_000);
        assertEq(r.decimals, 6);
        assertEq(r.confidence, 9700);
        assertEq(r.revision, 0);
        assertEq(r.reportTimestamp, 1_710_288_000_000);
        assertEq(r.inputManifestHash, bytes32(uint256(0xabc)));
        assertEq(r.computationHash, bytes32(uint256(0xdef)));
    }

    function test_postReport_accepts_newer_timestamp() public {
        oracle.postReport(AEGDP, 100, 6, 9700, 0, 1_000_000, bytes32(0), bytes32(0));
        oracle.postReport(AEGDP, 200, 6, 9700, 0, 2_000_000, bytes32(0), bytes32(0));

        LucidOracle.Report memory r = oracle.getLatestReport(AEGDP);
        assertEq(r.value, 200);
        assertEq(r.reportTimestamp, 2_000_000);
    }

    function test_postReport_accepts_same_timestamp_higher_revision() public {
        oracle.postReport(AEGDP, 100, 6, 9700, 0, 1_000_000, bytes32(0), bytes32(0));
        oracle.postReport(AEGDP, 105, 6, 9700, 1, 1_000_000, bytes32(0), bytes32(0));

        LucidOracle.Report memory r = oracle.getLatestReport(AEGDP);
        assertEq(r.value, 105);
        assertEq(r.revision, 1);
    }

    function test_postReport_rejects_stale_timestamp_same_revision() public {
        oracle.postReport(AEGDP, 100, 6, 9700, 0, 2_000_000, bytes32(0), bytes32(0));

        vm.expectRevert(LucidOracle.StaleReport.selector);
        oracle.postReport(AEGDP, 200, 6, 9700, 0, 1_000_000, bytes32(0), bytes32(0));
    }

    function test_postReport_rejects_same_timestamp_same_revision() public {
        oracle.postReport(AEGDP, 100, 6, 9700, 0, 1_000_000, bytes32(0), bytes32(0));

        vm.expectRevert(LucidOracle.StaleReport.selector);
        oracle.postReport(AEGDP, 200, 6, 9700, 0, 1_000_000, bytes32(0), bytes32(0));
    }

    function test_postReport_rejects_non_authority() public {
        vm.prank(nonAuthority);
        vm.expectRevert(LucidOracle.NotAuthority.selector);
        oracle.postReport(AEGDP, 100, 6, 9700, 0, 1_000_000, bytes32(0), bytes32(0));
    }

    function test_postReport_independent_feeds() public {
        oracle.postReport(AEGDP, 100, 6, 9700, 0, 1_000_000, bytes32(0), bytes32(0));
        oracle.postReport(AAI, 742, 0, 9500, 0, 1_000_000, bytes32(0), bytes32(0));

        assertEq(oracle.getLatestReport(AEGDP).value, 100);
        assertEq(oracle.getLatestReport(AAI).value, 742);
    }

    // --- getLatestReport ---

    function test_getLatestReport_returns_zeroes_for_uninitialized() public view {
        LucidOracle.Report memory r = oracle.getLatestReport(AEGDP);
        assertEq(r.value, 0);
        assertEq(r.reportTimestamp, 0);
    }

    // --- rotateAuthority ---

    function test_rotateAuthority_transfers_and_emits() public {
        address newAuth = address(0x1234);

        vm.expectEmit(true, true, false, false);
        emit LucidOracle.AuthorityRotated(authority, newAuth);

        oracle.rotateAuthority(newAuth);
        assertEq(oracle.authority(), newAuth);
    }

    function test_rotateAuthority_old_authority_rejected() public {
        address newAuth = address(0x1234);
        oracle.rotateAuthority(newAuth);

        vm.expectRevert(LucidOracle.NotAuthority.selector);
        oracle.postReport(AEGDP, 100, 6, 9700, 0, 1_000_000, bytes32(0), bytes32(0));
    }

    function test_rotateAuthority_rejects_zero_address() public {
        vm.expectRevert(LucidOracle.ZeroAddress.selector);
        oracle.rotateAuthority(address(0));
    }

    function test_rotateAuthority_rejects_non_authority() public {
        vm.prank(nonAuthority);
        vm.expectRevert(LucidOracle.NotAuthority.selector);
        oracle.rotateAuthority(address(0x1234));
    }
}
