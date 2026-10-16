# Project and deployment visibility

Every new deployable Code Black project must include a `codeblack.project.v1`
manifest under `.codeblack/projects/` with its host IDs, service IDs, systemd
units (or Windows scheduled task names) and operator links. Use existing project IDs when extending an existing
project. Preserve declared planning milestones; runtime presence is not release
qualification.

Run deployment commands through `scripts/deploy_with_status.py`. It registers
the manifest and reports started/succeeded/failed attempts with the source Git
commit and dirty-checkout flag over the existing SSH connection. Commit source
before deploying so the running version can be attributed accurately. Include
the actual health check in the wrapped command; a copy or restart alone is not
proof of a successful deployment.

Core and Edge discover installed Code Black systemd units; Phaenon3 discovers
Code Black/Spencer Labs scheduled tasks and Windows services. The Windows
collector also sends bounded discovery reports through existing SSH access.
Inspect the Status Center coverage panel
after deploying. Unregistered units remain visible as discovered/unverified;
register their purpose and functional checks before treating them as qualified.

See `status-center/PROJECT_AUTOMATION.md` for deployment and rollback examples.
