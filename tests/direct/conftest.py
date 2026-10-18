import os
import sys

import pytest

_real_unlink = os.unlink


def _windows_safe_unlink(path, *args, **kwargs):
    try:
        return _real_unlink(path, *args, **kwargs)
    except PermissionError:
        return None


os.unlink = _windows_safe_unlink

# Default contract clock for every test. Tests that need another time warp explicitly.
NOW = "2099-01-01T00:00:00Z"


def warp_to(direct_vm, iso: str) -> None:
    direct_vm.warp(iso)
    gl = sys.modules.get("genlayer.gl")
    if gl is None:
        return
    raw = getattr(gl, "message_raw", None)
    if isinstance(raw, dict):
        raw["datetime"] = iso


@pytest.fixture
def contract(direct_deploy, direct_vm, direct_alice):
    warp_to(direct_vm, NOW)
    direct_vm.sender = direct_alice
    deployed = direct_deploy("contracts/Marketplace.py", args=[])
    direct_vm.sender = direct_alice
    # Listings pass the policy check by default. Tests that need a block replace this mock.
    direct_vm.mock_llm("MARKETPLACE_POLICY_CHECK", '{"status": "allowed"}')
    return deployed
