"""Recorte por departamento de Budget (CLAUDE.md punto 16).

Budget es el único módulo con filtrado por FILA y no hay RLS que lo respalde
(service_role la bypassa). Si `_scoped()` deja pasar un departamento ajeno, es
un P0. Estos tests miran el filtro que queda en el builder REAL de
database.py (`q._params`), que es exactamente lo que viaja a PostgREST.
"""
import pytest
from fastapi import HTTPException

from api._lib import database
from api._lib.routers import budget


def _q():
    return database._QueryBuilder("http://supabase.invalid", {}, "expenses").select("*")


def _row(dept, view=False, edit=False, approve=None, user="user-1"):
    row = {"user_id": user, "department_code": dept, "can_view": view, "can_edit": edit}
    if approve is not None:   # None = fila pre-048, sin la columna
        row["can_approve"] = approve
    return row


@pytest.fixture
def access(monkeypatch):
    """Parchea las dos fuentes de `_departments_for`: superadmin y filas."""
    state = {"superadmin": False, "rows": []}
    monkeypatch.setattr(budget, "is_superadmin_request", lambda request: state["superadmin"])
    monkeypatch.setattr(budget, "_access_rows", lambda request: state["rows"])

    def set_(rows=(), superadmin=False):
        state["rows"] = list(rows)
        state["superadmin"] = superadmin
    return set_


# ─── _scoped ─────────────────────────────────────────────────────────────────

class TestScoped:
    def test_superadmin_has_no_filter(self, access, make_request):
        access(superadmin=True)
        q = budget._scoped(_q(), make_request())
        assert "department_code" not in q._params

    def test_star_view_row_has_no_filter(self, access, make_request):
        access([_row("*", view=True)])
        q = budget._scoped(_q(), make_request())
        assert "department_code" not in q._params

    def test_department_scope_becomes_in(self, access, make_request):
        access([_row("it", view=True)])
        q = budget._scoped(_q(), make_request())
        assert q._params["department_code"] == 'in.("it")'

    def test_multiple_departments(self, access, make_request):
        access([_row("it", view=True), _row("comms", view=True), _row("finance")])
        q = budget._scoped(_q(), make_request())
        assert q._params["department_code"] == 'in.("comms","it")'

    def test_no_rows_fails_closed(self, access, make_request):
        access([])
        q = budget._scoped(_q(), make_request())
        assert q._params["department_code"] == "in.()"

    def test_requested_outside_scope_matches_nothing(self, access, make_request):
        # El bypass que documenta _scoped(): ?department=finance no puede
        # pisar el scope con un eq.
        access([_row("it", view=True)])
        q = budget._scoped(_q(), make_request(), requested="finance")
        assert q._params["department_code"] == "in.()"

    def test_requested_inside_scope_is_eq(self, access, make_request):
        access([_row("it", view=True), _row("comms", view=True)])
        q = budget._scoped(_q(), make_request(), requested="it")
        assert q._params["department_code"] == "eq.it"

    def test_superadmin_requested_is_eq(self, access, make_request):
        access(superadmin=True)
        q = budget._scoped(_q(), make_request(), requested="finance")
        assert q._params["department_code"] == "eq.finance"

    def test_approve_intersects_with_view(self, access, make_request):
        access([_row("it", view=True, approve=True), _row("comms", view=True, approve=False)])
        q = budget._scoped(_q(), make_request(), action="approve")
        assert q._params["department_code"] == 'in.("it")'

    def test_approve_requested_outside_approve_scope(self, access, make_request):
        access([_row("it", view=True, approve=True), _row("comms", view=True, approve=False)])
        q = budget._scoped(_q(), make_request(), requested="comms", action="approve")
        assert q._params["department_code"] == "in.()"

    def test_reads_access_rows_from_request_cache(self, fake_db, make_request):
        # Sin parches: el scope sale del cache del request y de la base falsa.
        fake_db.seed("budget_access", [
            _row("it", view=True, user="user-1"),
            _row("finance", view=True, user="someone-else"),
        ])
        request = make_request("user-1")
        q = budget._scoped(_q(), request)
        assert q._params["department_code"] == 'in.("it")'
        # Solo se consultan las filas del caller, y una vez por request.
        budget._scoped(_q(), request)
        calls = fake_db.calls_to("budget_access")
        assert len(calls) == 1 and calls[0].params["user_id"] == "eq.user-1"


# ─── _departments_for ────────────────────────────────────────────────────────

class TestDepartmentsFor:
    ROWS = [
        _row("it", view=True, edit=True, approve=False),
        _row("comms", view=True, edit=False, approve=True),
        _row("finance", view=False, edit=False, approve=True),   # aprueba sin ver
    ]

    def test_view(self, access, make_request):
        access(self.ROWS)
        assert budget._departments_for(make_request(), "view") == ["comms", "it"]

    def test_edit(self, access, make_request):
        access(self.ROWS)
        assert budget._departments_for(make_request(), "edit") == ["it"]

    def test_approve_requires_can_view(self, access, make_request):
        access(self.ROWS)
        assert budget._departments_for(make_request(), "approve") == ["comms"]

    def test_approve_without_column_fails_closed(self, access, make_request):
        # Migración 048 no aplicada: las filas no traen can_approve.
        access([_row("it", view=True, edit=True)])
        assert budget._departments_for(make_request(), "approve") == []

    def test_edit_does_not_imply_approve(self, access, make_request):
        access([_row("it", view=True, edit=True, approve=False)])
        assert budget._departments_for(make_request(), "approve") == []

    def test_star_row_grants_all_per_action(self, access, make_request):
        access([_row("*", view=True, edit=True, approve=False)])
        request = make_request()
        assert budget._departments_for(request, "view") is None
        assert budget._departments_for(request, "edit") is None
        assert budget._departments_for(request, "approve") == []

    def test_star_approve_without_view_does_not_grant(self, access, make_request):
        access([_row("*", view=False, approve=True)])
        assert budget._departments_for(make_request(), "approve") == []

    def test_superadmin_is_unrestricted(self, access, make_request):
        access([], superadmin=True)
        for action in ("view", "edit", "approve"):
            assert budget._departments_for(make_request(), action) is None

    def test_unknown_action_raises(self, access, make_request):
        access(self.ROWS)
        with pytest.raises(ValueError):
            budget._departments_for(make_request(), "aprove")


# ─── _assert_can_approve / _is_general_admin ─────────────────────────────────

class TestApproveAndGeneralAdmin:
    def test_assert_can_approve_ok(self, access, make_request):
        access([_row("it", view=True, approve=True)])
        budget._assert_can_approve(make_request(), "it")

    @pytest.mark.parametrize("code", ["comms", None, ""])
    def test_assert_can_approve_403(self, access, make_request, code):
        access([_row("it", view=True, approve=True)])
        with pytest.raises(HTTPException) as exc:
            budget._assert_can_approve(make_request(), code)
        assert exc.value.status_code == 403

    def test_assert_can_approve_403_for_editor(self, access, make_request):
        access([_row("it", view=True, edit=True, approve=False)])
        with pytest.raises(HTTPException) as exc:
            budget._assert_can_approve(make_request(), "it")
        assert exc.value.status_code == 403

    def test_assert_can_approve_superadmin(self, access, make_request):
        access([], superadmin=True)
        budget._assert_can_approve(make_request(), "anything")

    @pytest.mark.parametrize("rows, superadmin, expected", [
        ([_row("*", view=True, edit=True)], False, True),
        ([_row("*", view=True, edit=False)], False, False),
        ([_row("it", view=True, edit=True), _row("comms", view=True, edit=True)], False, False),
        ([], False, False),
        ([], True, True),
    ])
    def test_is_general_admin(self, access, make_request, rows, superadmin, expected):
        access(rows, superadmin=superadmin)
        assert budget._is_general_admin(make_request()) is expected

    def test_assert_general_admin_403(self, access, make_request):
        access([_row("it", view=True, edit=True)])
        with pytest.raises(HTTPException) as exc:
            budget._assert_general_admin(make_request())
        assert exc.value.status_code == 403
