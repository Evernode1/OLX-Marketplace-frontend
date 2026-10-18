"""Minimal stand-in for the parts of pytest the repo's tests use.
pytest.raises enforces `match` with re.search on the error text, as real pytest does."""
import re as _re
import inspect as _inspect

FIXTURES = {}


def fixture(func=None, **kw):
    def reg(f):
        FIXTURES[f.__name__] = f
        return f
    return reg(func) if func is not None else reg


class _Raises:
    def __init__(self, exc, match=None):
        self.exc = exc
        self.match = match

    def __enter__(self):
        return self

    def __exit__(self, et, ev, tb):
        import genlayer
        if et is None:
            raise AssertionError("DID NOT RAISE")
        # Only contract-level rejections count; a Python bug must fail the test.
        if not issubclass(et, genlayer.UserError):
            return False
        if self.match is not None and not _re.search(self.match, str(ev)):
            raise AssertionError(f"error {str(ev)!r} does not match {self.match!r}")
        return True


def raises(exc, match=None, **kw):
    return _Raises(exc, match)
