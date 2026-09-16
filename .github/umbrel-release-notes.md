<!-- version: 2.66.2 -->
This is a security update and changes nothing else. It closes a gap in single sign-on: an account for housekeeping staff, which has never been allowed to sign in with a password, could still get in through your SSO provider and end up with a full household member's session. Only households that have single sign-on configured were affected. If you use SSO and keep staff accounts, update soon.

There are no database migrations and nothing to do beyond updating.

Full release notes are available at https://github.com/ulsklyc/yuvomi/releases/tag/v2.66.2
