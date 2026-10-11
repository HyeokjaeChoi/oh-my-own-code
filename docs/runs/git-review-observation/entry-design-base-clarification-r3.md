**제안한 해석으로 구현할 수 있습니다. 중대한 계약 공백으로 flag할 필요는 없습니다.** 현재 문서는 detail에 “exact held original observation”을 요구하고, transport error도 허용합니다. [관련 계약](/Users/hyukjaechoi/Projects/oh-my-own-code/docs/runs/git-review-observation/design.md:54)

처리 순서는 다음과 같습니다.

1. **인증·scope 확인 후**, 원래 observation과 branch table을 찾습니다.
2. Unknown·evicted ID, 다른 scope의 ID, 원래 branch table에 없는 `baseRef`는 기존 transport error로 거절합니다. Detail DTO를 만들지 않습니다.
3. Metadata가 남아 있고 `baseRef`가 유효하면, 원래 table의 OID를 `baseOid`로 사용합니다.
4. 그 observation이 만료됐다면 `unavailable: expired_observation`과 **원래 `baseOid`**를 반환합니다. 현재 branch TIP으로 다시 계산하지 않습니다.

따라서 `baseOid: null`은 필요하지 않습니다. 만료 metadata를 이미 제거했다면 unknown·evicted 경로로 처리하면 됩니다. 만료 응답을 위해 metadata를 무기한 보존할 필요도 없습니다.

이 해석은 기존 bounded metadata와 응답 shape를 유지합니다. 파일·보고서는 변경하지 않았습니다.
