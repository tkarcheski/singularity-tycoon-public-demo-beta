*** Settings ***
Documentation     Surfaces the pytest unit suite inside the Robot Framework report.
...               The single placeholder test below is replaced at run time by the
...               `inject_unit_tests` pre-run modifier, which adds one test per pytest
...               unit test (see tests/integration/pytest_bridge.py). Run the whole
...               integration dir with that modifier on PYTHONPATH:
...
...               PYTHONPATH=tests/integration robot \
...                 --prerunmodifier pytest_bridge.inject_unit_tests \
...                 --outputdir results/robot tests/integration
Library           pytest_bridge.PytestBridge


*** Test Cases ***
Unit Tests Pending Injection
    [Documentation]    Placeholder so the suite parses standalone. When the
    ...                pre-run modifier is active this test is removed and replaced
    ...                with the collected pytest unit tests.
    Log    Run with --prerunmodifier pytest_bridge.inject_unit_tests to populate this suite.
