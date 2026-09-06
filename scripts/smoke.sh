#!/usr/bin/env bash
#
# End-to-end smoke test against a running server.
#
#   npm run dev          # in one terminal
#   npm run smoke        # in another
#
# Exercises the whole loop with two users, plus every guard that protects money:
# who may claim, who may approve, and whether a payment can be recorded against
# an address that is not the doer's.
#
# Writes into whatever DATA_FILE the server is using. Point the server at a
# scratch file if you care about the contents.

set -uo pipefail

BASE="${BASE:-http://localhost:8787}"
API="$BASE/api"
PASS=0
FAIL=0

pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  \033[31mFAIL\033[0m %s\n     expected: %s\n     actual:   %s\n' "$1" "$2" "$3"; FAIL=$((FAIL + 1)); }

# assert <label> <expected> <actual>
assert() {
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "$2" "$3"; fi
}

# assert_has <label> <needle> <haystack>
assert_has() {
  case "$3" in
    *"$2"*) pass "$1" ;;
    *) fail "$1" "contains: $2" "$3" ;;
  esac
}

j() { curl -s -H 'content-type: application/json' "$@"; }
pluck() { node -pe "try{JSON.parse(require('fs').readFileSync(0))$1}catch(e){'PARSE_ERROR'}"; }

echo
echo "Chore Circle smoke test -> $BASE"
echo

if ! curl -s -m 3 "$BASE/healthz" | grep -q '"ok":true'; then
  echo "  Server is not answering on $BASE. Start it with: npm run dev"
  exit 1
fi

# ---------------------------------------------------------------- setup

ALICE=$(j -X POST -d '{"displayName":"Alice"}' "$API/session" | pluck '.user.id')
BOB=$(j -X POST -d '{"displayName":"Bob"}' "$API/session" | pluck '.user.id')
A=(-H "x-user-id: $ALICE")
B=(-H "x-user-id: $BOB")

ALICE_ADDR="NQ11 ALIC E000 0000 0000 0000 0000 0000 0000"
BOB_ADDR="NQ22 BOBB 0000 0000 0000 0000 0000 0000 0000"
j "${A[@]}" -X PUT -d "{\"chain\":\"nimiq\",\"address\":\"$ALICE_ADDR\"}" "$API/me/addresses" > /dev/null

CIRCLE=$(j "${A[@]}" -X POST -d '{"name":"Smoke House","kind":"family"}' "$API/circles")
CID=$(echo "$CIRCLE" | pluck '.circle.id')
CODE=$(echo "$CIRCLE" | pluck '.circle.inviteCode')

echo "circles"
assert_has "bob joins with the invite code" "Smoke House" \
  "$(j "${B[@]}" -X POST -d "{\"code\":\"$CODE\"}" "$API/circles/join" | pluck '.circle.name')"
assert_has "a bad code is rejected" "does not match" \
  "$(j "${B[@]}" -X POST -d '{"code":"ZZZZZZ"}' "$API/circles/join" | pluck '.error')"

# ---------------------------------------------------------------- chores

T1=$(j "${A[@]}" -X POST -d "{\"title\":\"Bins\",\"amount\":\"2.5\",\"assetKey\":\"NIM\",\"circleIds\":[\"$CID\"]}" "$API/tasks" | pluck '.task.id')
T2=$(j "${A[@]}" -X POST -d "{\"title\":\"Dog\",\"amount\":\"4\",\"assetKey\":\"NIM\",\"circleIds\":[\"$CID\"]}" "$API/tasks" | pluck '.task.id')

echo
echo "validation"
assert_has "a chore needs a title" "What needs doing" \
  "$(j "${A[@]}" -X POST -d "{\"title\":\"\",\"amount\":\"1\",\"circleIds\":[\"$CID\"]}" "$API/tasks" | pluck '.error')"
assert_has "a zero reward is rejected" "more than zero" \
  "$(j "${A[@]}" -X POST -d "{\"title\":\"x\",\"amount\":\"0\",\"circleIds\":[\"$CID\"]}" "$API/tasks" | pluck '.error')"
assert_has "excess decimal precision is rejected" "decimal places" \
  "$(j "${A[@]}" -X POST -d "{\"title\":\"x\",\"amount\":\"1.1234567\",\"circleIds\":[\"$CID\"]}" "$API/tasks" | pluck '.error')"
assert_has "a chore must go to a circle" "at least one circle" \
  "$(j "${A[@]}" -X POST -d '{"title":"x","amount":"1","circleIds":[]}' "$API/tasks" | pluck '.error')"

echo
echo "lifecycle guards"
assert_has "you cannot claim your own chore" "your own chore" \
  "$(j "${A[@]}" -X POST "$API/tasks/$T1/claim" | pluck '.error')"
assert_has "you cannot approve before submission" "that is open" \
  "$(j "${A[@]}" -X POST "$API/tasks/$T1/approve" | pluck '.error')"

j "${B[@]}" -X POST "$API/tasks/$T1/claim" > /dev/null
j "${B[@]}" -X POST "$API/tasks/$T2/claim" > /dev/null

assert_has "a claimed chore cannot be claimed again" "that is claimed" \
  "$(j "${B[@]}" -X POST "$API/tasks/$T1/claim" | pluck '.error')"

j "${B[@]}" -X POST -d '{"signature":"mocksig:1"}' "$API/tasks/$T1/done" > /dev/null
j "${B[@]}" -X POST -d '{"signature":"mocksig:2"}' "$API/tasks/$T2/done" > /dev/null

assert_has "the doer cannot approve their own work" "Only the poster" \
  "$(j "${B[@]}" -X POST "$API/tasks/$T1/approve" | pluck '.error')"
assert_has "the signature is recorded in the ledger" "mocksig:1" \
  "$(j "${A[@]}" "$API/tasks" | pluck ".tasks.find(t=>t.id==='$T1').doneSignature")"

j "${A[@]}" -X POST "$API/tasks/$T1/approve" > /dev/null
j "${A[@]}" -X POST "$API/tasks/$T2/approve" > /dev/null

# ---------------------------------------------------------------- money

echo
echo "batching"
OWED=$(j "${A[@]}" "$API/tasks")
assert "two chores collapse into one bucket" "1" \
  "$(echo "$OWED" | pluck ".owed.filter(b=>b.posterId==='$ALICE').length")"
assert "2.5 + 4 NIM totals 650000 luna" "650000" \
  "$(echo "$OWED" | pluck ".owed.find(b=>b.posterId==='$ALICE').units")"
assert "the bucket covers both chores" "2" \
  "$(echo "$OWED" | pluck ".owed.find(b=>b.posterId==='$ALICE').taskIds.length")"

echo
echo "payout routing"
assert "an unregistered doer has no payout address" "null" \
  "$(echo "$OWED" | pluck ".owed.find(b=>b.posterId==='$ALICE').payTo")"
assert_has "settling an unpayable doer is refused" "has not added a wallet" \
  "$(j "${A[@]}" -X POST -d "{\"taskIds\":[\"$T1\"],\"railId\":\"nimiq\",\"txHash\":\"tx1\",\"paidTo\":\"$BOB_ADDR\"}" "$API/settle" | pluck '.error')"

j "${B[@]}" -X PUT -d "{\"chain\":\"nimiq\",\"address\":\"$BOB_ADDR\"}" "$API/me/addresses" > /dev/null

assert "payTo resolves to the doer, not the poster" "$BOB_ADDR" \
  "$(j "${A[@]}" "$API/tasks" | pluck ".owed.find(b=>b.posterId==='$ALICE').payTo.address")"
assert_has "paying a different address is rejected" "not go to the address on record" \
  "$(j "${A[@]}" -X POST -d "{\"taskIds\":[\"$T1\"],\"railId\":\"nimiq\",\"txHash\":\"tx2\",\"paidTo\":\"$ALICE_ADDR\"}" "$API/settle" | pluck '.error')"
assert_has "only the poster may settle" "chores you posted" \
  "$(j "${B[@]}" -X POST -d "{\"taskIds\":[\"$T1\"],\"railId\":\"nimiq\",\"txHash\":\"tx3\",\"paidTo\":\"$BOB_ADDR\"}" "$API/settle" | pluck '.error')"

SETTLED=$(j "${A[@]}" -X POST -d "{\"taskIds\":[\"$T1\",\"$T2\"],\"railId\":\"nimiq\",\"txHash\":\"tx4\",\"paidTo\":\"$BOB_ADDR\"}" "$API/settle")
assert "both chores settle in one transaction" "2" "$(echo "$SETTLED" | pluck '.settled.length')"
assert "the paid address is recorded" "$BOB_ADDR" "$(echo "$SETTLED" | pluck '.settled[0].settlement.paidTo')"
assert "nothing is left owing" "0" \
  "$(j "${A[@]}" "$API/tasks" | pluck ".owed.filter(b=>b.posterId==='$ALICE').length")"

# ------------------------------------------------------------ public pages

echo
echo "public pages (no auth, no app)"
assert_has "a chore page renders its title" "Bins" "$(curl -s "$BASE/t/$T1" | tr -d '\n')"
assert_has "a chore page carries OpenGraph tags" 'og:title' "$(curl -s "$BASE/t/$T1" | tr -d '\n')"
assert_has "a settled chore hides the accept button" "no longer open" "$(curl -s "$BASE/t/$T1" | tr -d '\n')"
assert_has "a join page renders the circle name" "Smoke House" "$(curl -s "$BASE/join/$CODE" | tr -d '\n')"
assert "an unknown chore 404s" "404" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/t/does-not-exist")"

echo
echo "auth"
assert_has "no user header is rejected" "Not signed in" "$(j "$API/tasks" | pluck '.error')"

echo
printf '%d passed, %d failed\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
