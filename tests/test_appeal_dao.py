import json
import pytest

CONTRACT_PATH = "contracts/appeal_dao.py"

FLAGGED = "https://example.com/ban-notice.jpg"
FLAGGED_2 = "https://archive.example.com/original-video"
POLICY_1 = "https://www.youtube.com/howyoutubeworks/policies/community-guidelines/"
POLICY_2 = "https://support.google.com/youtube/answer/2801939"

DEPOSIT = 100
BONUS = 50
POOL_FULL = 500
POOL_SHORT = 20


def _set_value(vm, amount):
    if hasattr(vm, "value"):
        try:
            vm.value = amount
        except Exception:
            pass
    if hasattr(vm, "_value"):
        vm._value = amount
    if hasattr(vm, "_refresh_gl_message"):
        vm._refresh_gl_message()


def _as(vm, sender):
    targets = [vm]
    try:
        from gltest.direct.loader import _get_active_vm
        active = _get_active_vm()
        if active is not None and active not in targets:
            targets.append(active)
    except Exception:
        pass
    for target in targets:
        if hasattr(target, "sender"):
            try:
                target.sender = sender
            except Exception:
                pass
        if hasattr(target, "_sender"):
            try:
                target._sender = sender
            except Exception:
                pass
        if hasattr(target, "_refresh_gl_message"):
            try:
                target._refresh_gl_message()
            except Exception:
                pass
    return vm


def _clear_value(vm):
    _set_value(vm, 0)


def _active_vm(direct_vm):
    try:
        from gltest.direct.loader import _get_active_vm
        return _get_active_vm() or direct_vm
    except Exception:
        return direct_vm


def _credit(vm, contract, amount):
    if vm is None or amount <= 0:
        return
    if hasattr(vm, "_balances") and hasattr(contract, "address"):
        vm._balances[contract.address] = vm._balances.get(contract.address, 0) + amount


def sim_installMocks(vm, web=None, llm=None):
    """Install nondet mocks before every AI tx. Prefer sim_installMocks if present."""
    web = web or {}
    llm_payload = llm if isinstance(llm, str) or llm is None else json.dumps(llm)

    if hasattr(vm, "sim_installMocks"):
        vm.sim_installMocks({"web": web, "llm": llm_payload})
        return
    if hasattr(vm, "sim_install_mocks"):
        vm.sim_install_mocks({"web": web, "llm": llm_payload})
        return

    if hasattr(vm, "clear_mocks"):
        try:
            vm.clear_mocks()
        except Exception:
            pass
    for url, body in web.items():
        payload = body if isinstance(body, dict) else {"status": 200, "body": body}
        vm.mock_web(url, payload)
    if llm_payload is not None:
        vm.mock_llm(".*", llm_payload)


def _parse(raw):
    if isinstance(raw, str):
        return json.loads(raw or "{}")
    return raw or {}


def _parse_list(raw):
    if isinstance(raw, str):
        return json.loads(raw or "[]")
    return raw or []


def _appeal(contract, appeal_id):
    return _parse(contract.get_appeal(appeal_id))


def _config(contract):
    return _parse(contract.get_config())


def _pool(contract):
    raw = contract.get_pool_balance()
    if isinstance(raw, dict):
        raw = raw.get("pool_balance", 0)
    return int(str(raw))


def _addr(account):
    if isinstance(account, (bytes, bytearray)):
        return "0x" + bytes(account).hex()
    if hasattr(account, "address"):
        return account.address
    if hasattr(account, "as_hex"):
        return account.as_hex
    return account


def _boot(direct_vm, direct_deploy, direct_accounts):
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)
    owner = getattr(vm, "sender", None)
    owner_hex = str(_addr(owner)).lower().replace("0x", "")
    others = [a for a in direct_accounts if str(_addr(a)).lower().replace("0x", "") != owner_hex]
    creator = others[0] if others else direct_accounts[1]
    extra = others[1] if len(others) > 1 else others[0]
    return contract, vm, owner, creator, extra


def _proxy_addr(proxy):
    for attr in ("address", "addr", "_address", "account"):
        if hasattr(proxy, attr):
            val = getattr(proxy, attr)
            if val is not None:
                try:
                    return str(val.as_hex if hasattr(val, "as_hex") else val).lower()
                except Exception:
                    return str(val).lower()
    return str(proxy).lower()


def _default_web():
    return {
        FLAGGED: "Ban notice: video removed for 'spam'. Original is a product review with no links or scams.",
        FLAGGED_2: "Original upload: unboxing review, no hate speech, no graphic content.",
        POLICY_1: "YouTube Community Guidelines: spam is unsolicited commercial content. Product reviews are allowed.",
        POLICY_2: "YouTube spam policy: misleading metadata and mass-unsolicited comments are violations. Honest reviews are not.",
    }


def _upheld_web():
    return {
        FLAGGED: "Ban notice: graphic violence and hate speech targeting a protected group.",
        POLICY_1: "YouTube Community Guidelines prohibit hate speech and graphic violence.",
        POLICY_2: "Hate speech policy: content attacking people based on protected attributes is removed.",
    }


def _setup(contract, vm, owner, deposit=DEPOSIT, bonus=BONUS, pool=0):
    _as(vm, owner)
    contract.set_config(deposit, bonus)
    if pool > 0:
        _set_value(vm, pool)
        _credit(vm, contract, pool)
        contract.fund_pool()
        _clear_value(vm)
    return _config(contract)


def _file(contract, vm, creator, platform="YouTube", desc="Honest product review removed as spam",
          flagged=None, policies=None, deposit=DEPOSIT):
    _as(vm, creator)
    _set_value(vm, deposit)
    _credit(vm, contract, deposit)
    appeal_id = contract.file_appeal(
        platform,
        desc,
        flagged or [FLAGGED],
        policies or [POLICY_1, POLICY_2],
    )
    _clear_value(vm)
    return str(appeal_id)


def _resolve(contract, vm, appeal_id, verdict="OVERTURNED", confidence=90, reason="Ban does not match policy", web=None):
    sim_installMocks(
        vm,
        web=web or _default_web(),
        llm={"verdict": verdict, "confidence": confidence, "reason": reason},
    )
    contract.resolve_appeal(appeal_id)


def test_set_config_owner_only_and_positive(direct_vm, direct_deploy, direct_accounts):
    contract, vm, owner, creator, outsider = _boot(direct_vm, direct_deploy, direct_accounts)

    _as(vm, outsider)
    with pytest.raises(Exception):
        contract.set_config(DEPOSIT, BONUS)

    _as(vm, owner)
    with pytest.raises(Exception):
        contract.set_config(0, BONUS)
    with pytest.raises(Exception):
        contract.set_config(DEPOSIT, 0)

    contract.set_config(DEPOSIT, BONUS)
    cfg = _config(contract)
    assert int(cfg["appeal_deposit_amount"]) == DEPOSIT
    assert int(cfg["overturned_bonus_amount"]) == BONUS
    assert bool(cfg["configured"]) is True


def test_file_appeal_blocked_before_config(direct_vm, direct_deploy, direct_accounts):
    creator = direct_accounts[1]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)
    _as(vm, creator)
    _set_value(vm, DEPOSIT)
    with pytest.raises(Exception):
        contract.file_appeal("YouTube", "desc", [FLAGGED], [POLICY_1, POLICY_2])
    _clear_value(vm)


def test_wrong_deposit_amount_blocked(direct_vm, direct_deploy, direct_accounts):
    contract, vm, owner, creator, _extra = _boot(direct_vm, direct_deploy, direct_accounts)
    _setup(contract, vm, owner)

    _as(vm, creator)
    _set_value(vm, DEPOSIT - 1)
    with pytest.raises(Exception):
        contract.file_appeal("YouTube", "desc", [FLAGGED], [POLICY_1, POLICY_2])

    _set_value(vm, DEPOSIT + 1)
    with pytest.raises(Exception):
        contract.file_appeal("YouTube", "desc", [FLAGGED], [POLICY_1, POLICY_2])
    _clear_value(vm)


def test_missing_evidence_and_policy_urls_blocked(direct_vm, direct_deploy, direct_accounts):
    contract, vm, owner, creator, _extra = _boot(direct_vm, direct_deploy, direct_accounts)
    _setup(contract, vm, owner)

    _as(vm, creator)
    _set_value(vm, DEPOSIT)
    with pytest.raises(Exception):
        contract.file_appeal("YouTube", "desc", [], [POLICY_1, POLICY_2])
    with pytest.raises(Exception):
        contract.file_appeal("YouTube", "desc", [FLAGGED], [POLICY_1])
    with pytest.raises(Exception):
        contract.file_appeal("", "desc", [FLAGGED], [POLICY_1, POLICY_2])
    with pytest.raises(Exception):
        contract.file_appeal("YouTube", "desc", ["not-a-url"], [POLICY_1, POLICY_2])
    _clear_value(vm)


def test_happy_path_overturned_full_bonus(direct_vm, direct_deploy, direct_accounts):
    contract, vm, owner, creator, _extra = _boot(direct_vm, direct_deploy, direct_accounts)
    _setup(contract, vm, owner, pool=POOL_FULL)

    appeal_id = _file(contract, vm, creator)
    assert appeal_id == "0"
    row = _appeal(contract, appeal_id)
    assert row["status"] == "SUBMITTED"
    assert int(row["deposit_paid"]) == DEPOSIT

    _as(vm, creator)
    _resolve(contract, vm, appeal_id, "OVERTURNED", 95, "Review content is allowed under spam policy")

    row = _appeal(contract, appeal_id)
    assert row["status"] == "RESOLVED_OVERTURNED"
    assert row["verdict"] == "OVERTURNED"
    assert row["settled"] is True
    assert int(row["final_payout_amount"]) == DEPOSIT + BONUS
    assert int(row["confidence"]) == 95
    assert _pool(contract) == POOL_FULL - BONUS


def test_happy_path_overturned_bonus_capped_by_pool(direct_vm, direct_deploy, direct_accounts):
    contract, vm, owner, creator, _extra = _boot(direct_vm, direct_deploy, direct_accounts)
    _setup(contract, vm, owner, pool=POOL_SHORT)

    appeal_id = _file(contract, vm, creator)
    _as(vm, creator)
    _resolve(contract, vm, appeal_id, "OVERTURNED", 88, "Ban does not match stated policy")

    row = _appeal(contract, appeal_id)
    assert row["status"] == "RESOLVED_OVERTURNED"
    assert row["settled"] is True
    assert int(row["final_payout_amount"]) == DEPOSIT + POOL_SHORT
    assert _pool(contract) == 0


def test_happy_path_upheld_deposit_goes_to_pool(direct_vm, direct_deploy, direct_accounts):
    contract, vm, owner, creator, _extra = _boot(direct_vm, direct_deploy, direct_accounts)
    _setup(contract, vm, owner, pool=POOL_FULL)

    appeal_id = _file(contract, vm, creator, desc="Video with hate speech", flagged=[FLAGGED])
    _as(vm, creator)
    _resolve(
        contract, vm, appeal_id,
        "UPHELD", 92, "Content violates hate speech policy",
        web=_upheld_web(),
    )

    row = _appeal(contract, appeal_id)
    assert row["status"] == "RESOLVED_UPHELD"
    assert row["verdict"] == "UPHELD"
    assert row["settled"] is True
    assert int(row["final_payout_amount"]) == 0
    assert _pool(contract) == POOL_FULL + DEPOSIT


def test_low_confidence_disputed_then_add_evidence_and_re_resolve(direct_vm, direct_deploy, direct_accounts):
    contract, vm, owner, creator, outsider = _boot(direct_vm, direct_deploy, direct_accounts)
    _setup(contract, vm, owner, pool=POOL_FULL)

    appeal_id = _file(contract, vm, creator)
    _as(vm, creator)
    _resolve(contract, vm, appeal_id, "OVERTURNED", 45, "Evidence is incomplete")

    row = _appeal(contract, appeal_id)
    assert row["status"] == "DISPUTED"
    assert row["settled"] is False
    assert int(row["confidence"]) == 45

    _as(vm, outsider)
    with pytest.raises(Exception):
        contract.add_evidence(appeal_id, [FLAGGED_2], [])

    _as(vm, creator)
    contract.add_evidence(appeal_id, [FLAGGED_2], [])
    row = _appeal(contract, appeal_id)
    assert row["status"] == "SUBMITTED"
    assert FLAGGED_2 in row["flagged_content_urls"]

    _as(vm, creator)
    _resolve(contract, vm, appeal_id, "OVERTURNED", 91, "Supplemental archive confirms allowed review")
    row = _appeal(contract, appeal_id)
    assert row["status"] == "RESOLVED_OVERTURNED"
    assert row["settled"] is True
    assert int(row["final_payout_amount"]) == DEPOSIT + BONUS


def test_broken_json_goes_disputed(direct_vm, direct_deploy, direct_accounts):
    contract, vm, owner, creator, _extra = _boot(direct_vm, direct_deploy, direct_accounts)
    _setup(contract, vm, owner, pool=POOL_FULL)

    appeal_id = _file(contract, vm, creator)
    sim_installMocks(vm, web=_default_web(), llm="this is not json {{{")
    _as(vm, creator)
    contract.resolve_appeal(appeal_id)

    row = _appeal(contract, appeal_id)
    assert row["status"] == "DISPUTED"
    assert row["settled"] is False
    assert int(_config(contract)["pool_balance"]) == POOL_FULL


def test_web_fetch_failure_reverts(direct_vm, direct_deploy, direct_accounts):
    contract, vm, owner, creator, _extra = _boot(direct_vm, direct_deploy, direct_accounts)
    _setup(contract, vm, owner, pool=POOL_FULL)

    appeal_id = _file(contract, vm, creator)
    sim_installMocks(
        vm,
        web={POLICY_1: "policy ok", POLICY_2: "policy ok"},
        llm={"verdict": "OVERTURNED", "confidence": 99, "reason": "should not run"},
    )
    _as(vm, creator)
    with pytest.raises(Exception):
        contract.resolve_appeal(appeal_id)

    row = _appeal(contract, appeal_id)
    assert row["status"] == "SUBMITTED"
    assert row["settled"] is False
    assert _pool(contract) == POOL_FULL


def test_double_resolve_blocked(direct_vm, direct_deploy, direct_accounts):
    contract, vm, owner, creator, _extra = _boot(direct_vm, direct_deploy, direct_accounts)
    _setup(contract, vm, owner, pool=POOL_FULL)

    appeal_id = _file(contract, vm, creator)
    _as(vm, creator)
    _resolve(contract, vm, appeal_id, "UPHELD", 90, "Violates policy", web=_upheld_web())
    assert _appeal(contract, appeal_id)["status"] == "RESOLVED_UPHELD"

    with pytest.raises(Exception):
        _resolve(contract, vm, appeal_id, "OVERTURNED", 99, "should not re-run")


def test_transfer_fail_rolls_back_bonus_then_retry_uses_locked_payout(
    direct_vm, direct_deploy, direct_accounts, monkeypatch
):
    contract, vm, owner, creator, outsider = _boot(direct_vm, direct_deploy, direct_accounts)
    _setup(contract, vm, owner, pool=POOL_FULL)

    appeal_id = _file(contract, vm, creator)
    locked_payout = DEPOSIT + BONUS

    import gltest.direct.loader
    original_emit = gltest.direct.loader._EOAProxy.emit_transfer

    def failing_emit_transfer(self, value=None, **kwargs):
        raise Exception("Simulated native transfer execution failure")

    monkeypatch.setattr(gltest.direct.loader._EOAProxy, "emit_transfer", failing_emit_transfer)

    _as(vm, creator)
    _resolve(contract, vm, appeal_id, "OVERTURNED", 97, "Ban was incorrect")

    row = _appeal(contract, appeal_id)
    assert row["status"] == "PAYOUT_FAILED"
    assert row["settled"] is False
    assert int(row["final_payout_amount"]) == locked_payout
    assert _pool(contract) == POOL_FULL
    assert "Transfer failed" in row["verdict_reason"]

    _as(vm, outsider)
    with pytest.raises(Exception):
        contract.retry_resolution(appeal_id)

    monkeypatch.undo()
    payments = []

    def recording_emit(self, value=None, **kwargs):
        payments.append(int(value or 0))
        return original_emit(self, value, **kwargs)

    monkeypatch.setattr(gltest.direct.loader._EOAProxy, "emit_transfer", recording_emit)

    _as(vm, creator)
    contract.retry_resolution(appeal_id)

    row = _appeal(contract, appeal_id)
    assert row["status"] == "RESOLVED_OVERTURNED"
    assert row["settled"] is True
    assert int(row["final_payout_amount"]) == locked_payout
    assert payments == [locked_payout]


def test_retry_blocked_unless_payout_failed(direct_vm, direct_deploy, direct_accounts):
    contract, vm, owner, creator, _extra = _boot(direct_vm, direct_deploy, direct_accounts)
    _setup(contract, vm, owner, pool=POOL_FULL)

    appeal_id = _file(contract, vm, creator)
    _as(vm, creator)
    with pytest.raises(Exception):
        contract.retry_resolution(appeal_id)

    _resolve(contract, vm, appeal_id, "UPHELD", 90, "Violates policy", web=_upheld_web())
    with pytest.raises(Exception):
        contract.retry_resolution(appeal_id)


def test_base_units_wei_roundtrip(direct_vm, direct_deploy, direct_accounts):
    contract, vm, owner, creator, _extra = _boot(direct_vm, direct_deploy, direct_accounts)

    ten_gen = 10 * 10**18
    two_gen = 2 * 10**18
    _setup(contract, vm, owner, deposit=two_gen, bonus=two_gen, pool=ten_gen)
    assert _pool(contract) == ten_gen

    appeal_id = _file(contract, vm, creator, deposit=two_gen)
    _as(vm, creator)
    _resolve(contract, vm, appeal_id, "OVERTURNED", 90, "Allowed content")

    row = _appeal(contract, appeal_id)
    assert row["status"] == "RESOLVED_OVERTURNED"
    assert int(row["deposit_paid"]) == two_gen
    assert int(row["final_payout_amount"]) == two_gen + two_gen
    assert _pool(contract) == ten_gen - two_gen


def test_list_appeals_and_fund_pool(direct_vm, direct_deploy, direct_accounts):
    contract, vm, owner, creator, donor = _boot(direct_vm, direct_deploy, direct_accounts)
    _setup(contract, vm, owner, pool=0)

    _as(vm, donor)
    _set_value(vm, 250)
    _credit(vm, contract, 250)
    contract.fund_pool()
    _clear_value(vm)
    assert _pool(contract) == 250

    _file(contract, vm, creator)
    listed = _parse_list(contract.list_appeals())
    assert len(listed) == 1
    assert listed[0]["id"] == "0"
    assert listed[0]["status"] == "SUBMITTED"
    assert contract.get_appeal_count() == 1
