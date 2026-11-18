import unittest
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from api._lib import auth
from api._lib.routers import feed


def request_for(user=None):
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
    if user is not None:
        request.state.user = user
    return request


class AuthorizationDependenciesTest(unittest.TestCase):
    def test_view_requires_authentication(self):
        with self.assertRaises(HTTPException) as raised:
            auth.require_view("assets")(request_for())
        self.assertEqual(401, raised.exception.status_code)

    def test_view_denies_user_without_permission(self):
        request = request_for({"id": "user-1"})
        with patch.object(auth, "_has_permission", return_value=False):
            with self.assertRaises(HTTPException) as raised:
                auth.require_view("assets")(request)
        self.assertEqual(403, raised.exception.status_code)

    def test_view_allows_user_with_permission(self):
        request = request_for({"id": "user-1"})
        with patch.object(auth, "_has_permission", return_value=True) as permission:
            auth.require_view("assets")(request)
        permission.assert_called_once_with(request, "user-1", "assets", "view")

    def test_edit_checks_edit_permission(self):
        request = request_for({"id": "user-1"})
        with patch.object(auth, "_has_permission", return_value=True) as permission:
            auth.require_edit("assets")(request)
        permission.assert_called_once_with(request, "user-1", "assets", "edit")

    def test_superadmin_dependency_denies_regular_user(self):
        request = request_for({"id": "user-1"})
        with patch.object(auth, "_is_superadmin_cached", return_value=False):
            with self.assertRaises(HTTPException) as raised:
                auth.require_superadmin(request)
        self.assertEqual(403, raised.exception.status_code)


class FeedOwnershipTest(unittest.TestCase):
    def test_author_can_manage_own_post(self):
        request = request_for({"id": "author-1"})
        feed._assert_can_manage(request, {"author_id": "author-1"})

    def test_non_author_is_denied(self):
        request = request_for({"id": "user-2"})
        with patch.object(feed, "_is_moderator", return_value=False):
            with self.assertRaises(HTTPException) as raised:
                feed._assert_can_manage(request, {"author_id": "author-1"})
        self.assertEqual(403, raised.exception.status_code)

    def test_moderator_can_manage_another_users_post(self):
        request = request_for({"id": "moderator-1"})
        with patch.object(feed, "_is_moderator", return_value=True):
            feed._assert_can_manage(request, {"author_id": "author-1"})


if __name__ == "__main__":
    unittest.main()
