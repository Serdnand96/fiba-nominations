"""External Staff Evaluation — post-event assessment of the people that worked.

After a competition, the Competition Lead / Competition Support / Direct
Report rates each external staff member (the TDs and VGOs in `personnel`, NOT
the internal FIBA staff in `employees`) across a fixed set of topics, on a
1-5 scale, plus free-text strengths / areas to improve / comments.

The value is the historical record: `GET /evaluations/personnel/{id}` returns
everything ever written about a person, which is what feeds future nomination
decisions.

Evaluations are candid personnel data — the tables are backend-only (RLS on,
no policies) and every route is gated by the `evaluations` module permission,
view separate from edit.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from api._lib.auth import require_edit, require_view
from api._lib.database import supabase
from api._lib.schemas import StaffEvaluationCreate, StaffEvaluationUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/evaluations", tags=["evaluations"], dependencies=[Depends(require_view("evaluations"))])

# The topics the users asked to be evaluated on. Order is the display order.
# Adding one here is enough — scores are stored as jsonb, so no migration.
EVALUATION_CRITERIA = [
    "communication",
    "planning",
    "responsiveness",
    "operational_execution",
    "leadership",
    "reporting",
    "overall_performance",
]
_CRITERIA_SET = set(EVALUATION_CRITERIA)

_MIN_SCORE, _MAX_SCORE = 1, 5
_VALID_EVALUATOR_ROLES = {"competition_lead", "competition_support", "direct_report"}
_VALID_STATUSES = {"draft", "submitted"}


def _user_id(request: Request) -> Optional[str]:
    user = getattr(request.state, "user", None)
    if isinstance(user, dict):
        return user.get("id")
    return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_scores(scores: Optional[dict]) -> dict:
    """Keep only known criteria with an integer 1-5; reject anything else."""
    if not scores:
        return {}
    cleaned = {}
    for key, value in scores.items():
        if key not in _CRITERIA_SET:
            raise HTTPException(status_code=400, detail=f"Unknown criterion: {key}")
        if value is None or value == "":
            continue
        try:
            score = int(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"Score for {key} must be a number")
        if not _MIN_SCORE <= score <= _MAX_SCORE:
            raise HTTPException(status_code=400, detail=f"Score for {key} must be between {_MIN_SCORE} and {_MAX_SCORE}")
        cleaned[key] = score
    return cleaned


def _average(scores: dict) -> Optional[float]:
    """Mean of the criteria that were actually rated (blanks don't drag it down)."""
    if not scores:
        return None
    return round(sum(scores.values()) / len(scores), 2)


def _shape(row: dict) -> dict:
    """Flatten the nested person / competition into flat fields."""
    person = row.pop("personnel", None) or {}
    comp = row.pop("competitions", None) or {}
    row["personnel_name"] = person.get("name")
    row["personnel_role"] = person.get("role")
    row["personnel_country"] = person.get("country")
    row["competition_name"] = comp.get("name")
    row["competition_year"] = comp.get("year")
    return row


_SELECT = "*, personnel(name, role, country), competitions(name, year)"


# ─── Criteria catalogue (the frontend renders the form from this) ────────────
@router.get("/criteria")
def list_criteria():
    return {"criteria": EVALUATION_CRITERIA, "min": _MIN_SCORE, "max": _MAX_SCORE,
            "evaluator_roles": sorted(_VALID_EVALUATOR_ROLES)}


# ─── People to evaluate for an event, with what's already been written ───────
@router.get("/nominees")
def list_nominees(request: Request, competition_id: str = Query(...)):
    noms = (
        supabase.table("nominations")
        .select("id, personnel_id, status, personnel(name, role, country)")
        .eq("competition_id", competition_id)
        .execute()
        .data
    ) or []

    person_ids = [n["personnel_id"] for n in noms if n.get("personnel_id")]
    evals = (
        supabase.table("staff_evaluations")
        .select("*")
        .eq("competition_id", competition_id)
        .in_("personnel_id", person_ids or ["00000000-0000-0000-0000-000000000000"])
        .execute()
        .data
    ) or []

    me = _user_id(request)
    by_person: dict[str, list] = {}
    for e in evals:
        by_person.setdefault(e["personnel_id"], []).append(e)

    out = []
    seen = set()
    for n in noms:
        pid = n.get("personnel_id")
        if not pid or pid in seen:
            continue
        seen.add(pid)
        person = n.get("personnel") or {}
        mine = [e for e in by_person.get(pid, []) if e.get("created_by") == me]
        out.append({
            "personnel_id": pid,
            "nomination_id": n["id"],
            "nomination_status": n.get("status"),
            "personnel_name": person.get("name"),
            "personnel_role": person.get("role"),
            "personnel_country": person.get("country"),
            "evaluations": by_person.get(pid, []),
            "my_evaluation": mine[0] if mine else None,
        })
    out.sort(key=lambda r: (r["personnel_name"] or "").lower())
    return out


# ─── A person's full history, newest first ───────────────────────────────────
@router.get("/personnel/{personnel_id}")
def personnel_history(personnel_id: str):
    rows = (
        supabase.table("staff_evaluations")
        .select(_SELECT)
        .eq("personnel_id", personnel_id)
        .order("created_at", desc=True)
        .execute()
        .data
    ) or []
    rows = [_shape(r) for r in rows]

    rated = [r for r in rows if r.get("average") is not None]
    overall = round(sum(float(r["average"]) for r in rated) / len(rated), 2) if rated else None

    # Per-criterion mean across every evaluation, so strengths/weaknesses show
    # up without reading each one.
    per_criterion = {}
    for criterion in EVALUATION_CRITERIA:
        values = [r["scores"][criterion] for r in rows if (r.get("scores") or {}).get(criterion) is not None]
        if values:
            per_criterion[criterion] = round(sum(values) / len(values), 2)

    return {"count": len(rows), "average": overall, "per_criterion": per_criterion, "evaluations": rows}


# ─── List ────────────────────────────────────────────────────────────────────
@router.get("")
def list_evaluations(
    competition_id: Optional[str] = Query(None),
    personnel_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    q = supabase.table("staff_evaluations").select(_SELECT).order("created_at", desc=True)
    if competition_id:
        q = q.eq("competition_id", competition_id)
    if personnel_id:
        q = q.eq("personnel_id", personnel_id)
    if status:
        q = q.eq("status", status)
    return [_shape(r) for r in (q.execute().data or [])]


# ─── Create ──────────────────────────────────────────────────────────────────
@router.post("", status_code=201, dependencies=[Depends(require_edit("evaluations"))])
def create_evaluation(data: StaffEvaluationCreate, request: Request):
    person = supabase.table("personnel").select("id").eq("id", data.personnel_id).execute().data
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    comp = supabase.table("competitions").select("id").eq("id", data.competition_id).execute().data
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")
    if data.evaluator_role and data.evaluator_role not in _VALID_EVALUATOR_ROLES:
        raise HTTPException(status_code=400, detail="Invalid evaluator role")
    if data.status and data.status not in _VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")

    user_id = _user_id(request)
    if not user_id:
        # Should never happen — the middleware validates the JWT — but the
        # one-per-evaluator rule is only meaningful with an identified author.
        raise HTTPException(status_code=401, detail="Unauthenticated")

    existing = (
        supabase.table("staff_evaluations")
        .select("id")
        .eq("competition_id", data.competition_id)
        .eq("personnel_id", data.personnel_id)
        .eq("created_by", user_id)
        .execute()
        .data
    )
    if existing:
        raise HTTPException(status_code=409, detail="You already evaluated this person for this event")

    scores = _clean_scores(data.scores)
    record = {
        "competition_id": data.competition_id,
        "personnel_id": data.personnel_id,
        "evaluator_role": data.evaluator_role or "competition_lead",
        "scores": scores,
        "average": _average(scores),
        "strengths": data.strengths,
        "improvements": data.improvements,
        "comments": data.comments,
        "status": data.status or "draft",
        "created_by": user_id,
    }
    record = {k: v for k, v in record.items() if v is not None}
    return supabase.table("staff_evaluations").insert(record).execute().data[0]


# ─── Update ──────────────────────────────────────────────────────────────────
@router.put("/{evaluation_id}", dependencies=[Depends(require_edit("evaluations"))])
def update_evaluation(evaluation_id: str, data: StaffEvaluationUpdate):
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if "evaluator_role" in updates and updates["evaluator_role"] not in _VALID_EVALUATOR_ROLES:
        raise HTTPException(status_code=400, detail="Invalid evaluator role")
    if "status" in updates and updates["status"] not in _VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    if "scores" in updates:
        scores = _clean_scores(updates["scores"])
        updates["scores"] = scores
        updates["average"] = _average(scores)
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = _now_iso()

    result = supabase.table("staff_evaluations").update(updates).eq("id", evaluation_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    return result.data[0]


# ─── Delete ──────────────────────────────────────────────────────────────────
@router.delete("/{evaluation_id}", dependencies=[Depends(require_edit("evaluations"))])
def delete_evaluation(evaluation_id: str):
    result = supabase.table("staff_evaluations").delete().eq("id", evaluation_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    return {"ok": True}
