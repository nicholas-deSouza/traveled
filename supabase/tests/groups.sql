-- Run after migrations in a disposable database. All fixtures roll back.
\set ON_ERROR_STOP on
begin;
    create function pg_temp.assert(ok boolean, message text) returns void language plpgsql as $$
    begin
        if ok is distinct from true
        then
            raise exception 'FAILED: %',
            message;
        end
        if;
        end;
        $$;
        create function pg_temp.denied(statement text, expected_state text) returns void language plpgsql as $$
        begin
            begin execute statement;
                exception when others then
                if sqlstate = expected_state
                then
                    return;
                end
                if;
                    raise;
                end;
                raise exception 'FAILED: operation was allowed: %',
                statement;
            end;
            $$;
            insert into auth.users
                (
                    id
                )
            values
                (
                    '00000000-0000-0000-0000-000000000001'
                )
                ,
                (
                    '00000000-0000-0000-0000-000000000002'
                )
                ,
                (
                    '00000000-0000-0000-0000-000000000003'
                )
            ;
            set local role authenticated;
            select
                set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
            select
                public.create_group('Our group') as group_a \gset
            select
                public.create_group('Other group') as group_b \gset
            select
                pg_temp.assert(
                (
                    select
                        count(*) = 2
                    from
                        public.group_members
                    where
                        role = 'owner'), 'creator automatically owns both groups');
            select
                pg_temp.denied($q$select public.create_group('   ')$q$, 'P0001');
            insert into public.trips
                (
                    group_id,
                    title   ,
                    created_by
                )
            values
                (
                    :'group_a'  ,
                    'First trip',
                    auth.uid()
                )
                returning id as trip_a \gset
            insert into public.trips
                (
                    group_id,
                    title   ,
                    created_by
                )
            values
                (
                    :'group_b'  ,
                    'Other trip',
                    auth.uid()
                )
                returning id as trip_b \gset
            select
                token as first_token
            from
                public.create_group_invitation(:'group_a') \gset
            select
                token as current_token
            from
                public.create_group_invitation(:'group_a') \gset
            select
                pg_temp.assert(
                (
                    select
                        count(*) = 0
                    from
                        public.group_invitations), 'invitation hashes are not directly readable');
            select
                pg_temp.denied(format('select public.accept_group_invitation(%L)', :'first_token'), 'P0001');
            select
                pg_temp.assert(not public.can_access_trip_photo('bad/path/file.jpg'), 'malformed paths fail safely');
            select
                pg_temp.assert(not public.can_access_trip_photo(:'group_a' || '/' || :'trip_b' || '/file.jpg'), 'cross-group trip path denied even to member of both');
            select
                pg_temp.denied(format('insert into storage.objects(bucket_id,name,owner_id) values (''trip-photos'', %L, auth.uid()::text)', :'group_a' || '/' || :'trip_b' || '/file.jpg'), '42501');
            select
                set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
            select
                pg_temp.assert(
                (
                    select
                        count(*) = 0
                    from
                        public.groups), 'nonmember cannot read groups');
            select
                pg_temp.assert(
                (
                    select
                        count(*) = 0
                    from
                        public.trips), 'nonmember cannot read trips');
            select
                pg_temp.denied(format('insert into public.trips(group_id,title,created_by) values (%L, ''Intrusion'', auth.uid())', :'group_a'), '42501');
            select
                pg_temp.denied(format('insert into public.group_members(group_id,user_id) values (%L, auth.uid())', :'group_a'), '42501');
            select
                pg_temp.denied(format('select public.create_group_invitation(%L)', :'group_a'), 'P0001');
            select
                public.accept_group_invitation(:'current_token');
            select
                public.accept_group_invitation(:'current_token');
            select
                pg_temp.assert(
                (
                    select
                        count(*) = 2
                    from
                        public.group_members), 'repeat acceptance does not duplicate membership');
            select
                pg_temp.assert(
                (
                    select
                        count(*) = 1
                    from
                        public.groups), 'invite only unlocks its own group');
            select
                pg_temp.assert(
                (
                    select
                        count(*) = 1
                    from
                        public.trips), 'member can read group trips');
            select
                pg_temp.denied(format('select public.create_group_invitation(%L)', :'group_a'), 'P0001');
            select
                pg_temp.denied(format('select public.revoke_group_invitation(%L)', :'group_a'), 'P0001');
            insert into public.trips
                (
                    group_id,
                    title   ,
                    created_by
                )
            values
                (
                    :'group_a'   ,
                    'Member trip',
                    auth.uid()
                )
                returning id as member_trip \gset
            insert into storage.objects
                (
                    bucket_id,
                    name     ,
                    owner_id
                )
            values
                (
                    'trip-photos'                                      ,
                    :'group_a' || '/' || :'member_trip' || '/photo.jpg',
                    auth.uid()::text
                )
            ;
            insert into public.photos
                (
                    trip_id    ,
                    uploaded_by,
                    storage_path
                )
            values
                (
                    :'member_trip',
                    auth.uid()    ,
                    :'group_a' || '/' || :'member_trip' || '/photo.jpg'
                )
            ;
            select
                pg_temp.assert(
                (
                    select
                        count(*) = 1
                    from
                        public.photos), 'member uploads and reads photo metadata');
            select
                pg_temp.denied(format('insert into public.photos(trip_id,uploaded_by,storage_path) values (%L, auth.uid(), %L)', :'trip_a', :'group_a' || '/' || :'member_trip' || '/photo.jpg'), '42501');
            select
                pg_temp.denied(format('insert into public.photos(trip_id,uploaded_by,storage_path) values (%L, auth.uid(), %L)', :'trip_a', :'group_a' || '/' || :'trip_a' || '/missing.jpg'), '42501');
            select
                pg_temp.denied(format('update public.trips set group_id = %L where id = %L', :'group_b', :'member_trip'), 'P0001');
            update
                public.trips
            set
                title = 'Updated member trip'
            where
                id = :'member_trip';
            select
                pg_temp.assert(
                (
                    select
                        title = 'Updated member trip'
                    from
                        public.trips
                    where
                        id = :'member_trip'), 'member creator can update trip');
            select
                set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
            select
                pg_temp.assert(
                (
                    select
                        count(*) = 0
                    from
                        public.photos), 'outsider cannot read photos');
            select
                pg_temp.assert(
                (
                    select
                        count(*) = 0
                    from
                        storage.objects), 'outsider cannot download files');
            select
                pg_temp.denied(format('insert into storage.objects(bucket_id,name,owner_id) values (''trip-photos'', %L, auth.uid()::text)', :'group_a' || '/' || :'trip_a' || '/intrusion.jpg'), '42501');
            select
                set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
            select
                pg_temp.assert(
                (
                    select
                        count(*) = 1
                    from
                        public.photos), 'other group member can read photos');
            select
                pg_temp.assert(
                (
                    select
                        count(*) = 1
                    from
                        storage.objects), 'other group member can download photos');
            delete
            from
                public.group_members
            where
                group_id = :'group_a'
            and user_id  = auth.uid();
            select
                pg_temp.assert(public.is_group_member(:'group_a'), 'owner membership cannot be removed');
            delete
            from
                public.group_members
            where
                group_id = :'group_a'
            and user_id  = '00000000-0000-0000-0000-000000000002';
            select
                public.revoke_group_invitation(:'group_a');
            select
                pg_temp.denied(format('select public.accept_group_invitation(%L)', :'current_token'), 'P0001');
            select
                token as expired_token
            from
                public.create_group_invitation(:'group_a') \gset reset role;
            update
                public.group_invitations
            set
                expires_at = now() - interval '1 second'
            where
                group_id = :'group_a';
            set local role authenticated;
            select
                set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
            select
                pg_temp.denied(format('select public.accept_group_invitation(%L)', :'expired_token'), 'P0001');
            select
                pg_temp.assert(
                (
                    select
                        count(*) = 0
                    from
                        public.trips), 'removed creator cannot read trips');
            select
                pg_temp.assert(
                (
                    select
                        count(*) = 0
                    from
                        public.photos), 'removed uploader cannot read photos');
            select
                pg_temp.assert(
                (
                    select
                        count(*) = 0
                    from
                        storage.objects), 'removed uploader cannot read files');
            update
                public.trips
            set
                title = 'Forbidden'
            where
                id = :'member_trip';
            delete
            from
                public.trips
            where
                id = :'member_trip';
            delete
            from
                public.photos;
            delete
            from
                storage.objects;
            reset role;
            select
                pg_temp.assert(
                (
                    select
                        title = 'Updated member trip'
                    from
                        public.trips
                    where
                        id = :'member_trip'), 'removed creator cannot update or delete trip');
            select
                pg_temp.assert(
                (
                    select
                        count(*) = 1
                    from
                        public.photos), 'removed uploader cannot delete photos');
            select
                pg_temp.assert(
                (
                    select
                        count(*) = 1
                    from
                        storage.objects), 'removed uploader cannot delete files');
            set local role anon;
            select
                set_config('request.jwt.claim.sub', '', true);
            select
                pg_temp.denied(format('select public.accept_group_invitation(%L)', :'current_token'), '42501');
            select
                pg_temp.denied($q$select public.create_group('Anonymous')$q$, '42501');
            reset role;
            rollback;
            \echo 'All group security assertions passed.'