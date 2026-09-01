"""Tests for is_served_rss_stale and the processed_only render marker."""
from unittest.mock import MagicMock, patch

from tests.app_bootstrap import bootstrap

_test_data_dir = bootstrap('rss_stale_test_')

import main_app.feeds as feeds_mod
from rss_parser import RSSParser, extract_cached_processed_only


def _cached_rss(processed_only: bool | None, episode_ids: list[str]) -> str:
    """Minimal served RSS with optional processed_only marker and enclosures."""
    tag = ''
    if processed_only is not None:
        tag = (
            f'<podcast:txt purpose="minuspod-processed-only">'
            f'{str(processed_only).lower()}</podcast:txt>'
        )
    items = ''.join(
        f'<item><enclosure url="https://mp.example.com/show/episodes/{eid}.mp3" '
        f'type="audio/mpeg" /></item>'
        for eid in episode_ids
    )
    return f'<?xml version="1.0"?><rss><channel>{tag}{items}</channel></rss>'


class TestExtractCachedProcessedOnly:
    def test_roundtrip_true(self):
        rss = _cached_rss(True, [])
        assert extract_cached_processed_only(rss) is True

    def test_roundtrip_false(self):
        rss = _cached_rss(False, ['abc123'])
        assert extract_cached_processed_only(rss) is False

    def test_missing_tag_returns_none(self):
        assert extract_cached_processed_only('<rss><channel></channel></rss>') is None


class TestIsServedRssStale:
    PODCAST = {'id': 1, 'only_expose_processed_episodes': None}

    @patch.object(feeds_mod, 'db')
    def test_empty_cache_is_stale(self, db):
        assert feeds_mod.is_served_rss_stale('show', self.PODCAST, None) is True

    @patch.object(feeds_mod, 'db')
    def test_marker_mismatch_when_turning_off_processed_only(self, db):
        db.is_only_expose_processed_for_podcast.return_value = False
        db.get_processed_episodes_for_feed.return_value = []
        cached = _cached_rss(True, [])
        assert feeds_mod.is_served_rss_stale('show', self.PODCAST, cached) is True

    @patch.object(feeds_mod, 'db')
    def test_marker_mismatch_when_turning_on_processed_only(self, db):
        db.is_only_expose_processed_for_podcast.return_value = True
        db.get_processed_episodes_for_feed.return_value = []
        cached = _cached_rss(False, ['aaa111', 'bbb222'])
        assert feeds_mod.is_served_rss_stale('show', self.PODCAST, cached) is True

    @patch.object(feeds_mod, 'db')
    def test_legacy_cache_missing_unprocessed_episodes(self, db):
        """Pre-marker feeds: unprocessed DB rows absent from cache => stale."""
        db.is_only_expose_processed_for_podcast.return_value = False
        db.get_processed_episodes_for_feed.return_value = []
        db.get_episode_statuses_for_podcast.return_value = (
            {'disc111': 'discovered', 'proc222': 'processed'}, {}
        )
        cached = _cached_rss(None, ['proc222'])
        assert feeds_mod.is_served_rss_stale('show', self.PODCAST, cached) is True

    @patch.object(feeds_mod, 'db')
    def test_legacy_cache_ok_when_processed_only_on(self, db):
        """With processed_only on, missing unprocessed rows is expected."""
        db.is_only_expose_processed_for_podcast.return_value = True
        db.get_processed_episodes_for_feed.return_value = [
            {'episode_id': 'proc222'},
        ]
        db.get_episode_statuses_for_podcast.return_value = (
            {'disc111': 'discovered', 'proc222': 'processed'}, {}
        )
        cached = _cached_rss(None, ['proc222'])
        assert feeds_mod.is_served_rss_stale('show', self.PODCAST, cached) is False

    @patch.object(feeds_mod, 'db')
    def test_missing_processed_episode_is_stale(self, db):
        db.is_only_expose_processed_for_podcast.return_value = False
        db.get_processed_episodes_for_feed.return_value = [
            {'episode_id': 'proc222'},
        ]
        db.get_episode_statuses_for_podcast.return_value = (
            {'proc222': 'processed'}, {}
        )
        cached = _cached_rss(False, [])
        assert feeds_mod.is_served_rss_stale('show', self.PODCAST, cached) is True

    @patch.object(feeds_mod, 'db')
    def test_current_settings_match_is_fresh(self, db):
        db.is_only_expose_processed_for_podcast.return_value = False
        db.get_processed_episodes_for_feed.return_value = []
        db.get_episode_statuses_for_podcast.return_value = (
            {'aaa111': 'discovered'}, {}
        )
        cached = _cached_rss(False, ['aaa111'])
        assert feeds_mod.is_served_rss_stale('show', self.PODCAST, cached) is False


class TestProcessedOnlyMarkerInModifyFeed:
    def test_modify_feed_emits_marker(self):
        parser = RSSParser(base_url='https://mp.example.com')
        feed = """<?xml version="1.0"?><rss version="2.0"><channel>
            <title>T</title><link>https://example.com</link>
            <description>d</description>
            <item><title>E</title><guid>g1</guid>
            <enclosure url="https://cdn.example.com/a.mp3" type="audio/mpeg"/>
            </item></channel></rss>"""
        result = parser.modify_feed(feed, 'show', processed_only=True,
                                    processed_episode_ids=set())
        assert 'purpose="minuspod-processed-only">true<' in result
        result_off = parser.modify_feed(feed, 'show', processed_only=False)
        assert 'purpose="minuspod-processed-only">false<' in result_off


class Test304ForcesFetchWhenProcessedOnlyStale:
    """refresh_rss_feed must not 304-skip when the served RSS is stale."""

    @patch.object(feeds_mod, 'pattern_service')
    @patch.object(feeds_mod, 'status_service')
    @patch.object(feeds_mod, 'storage')
    @patch.object(feeds_mod, 'rss_parser')
    @patch.object(feeds_mod, 'db')
    def test_304_forces_fetch_when_unprocessed_missing(
        self, db, rss_parser, storage, status_service, pattern_service
    ):
        feeds_mod._refresh_coalesce.invalidate()
        slug = 'stale-processed-only-feed'
        podcast = {
            'id': 1, 'etag': 'etag-1', 'last_modified_header': None,
            'artwork_cached': True,
            'podping_checked_at': '2026-07-26T00:00:00Z',
            'channel_metadata_at': '2026-07-26T00:00:00Z',
        }
        db.get_podcast_by_slug.return_value = podcast
        db.get_episodes.return_value = ([], 1)
        db.get_processed_episodes_for_feed.return_value = []
        db.is_only_expose_processed_for_podcast.return_value = False
        db.get_episode_statuses_for_podcast.return_value = (
            {'disc111': 'discovered'}, {}
        )

        rss_parser.fetch_feed_conditional.side_effect = [
            (None, 'etag-1', None),
            (b'<rss/>', 'etag-1', None),
        ]
        storage.get_rss.return_value = _cached_rss(True, [])

        parsed = MagicMock()
        parsed.feed = {'title': 'Show', 'description': '', 'link': 'https://example.com'}
        parsed.entries = []
        parsed.bozo = False
        rss_parser.parse_feed.return_value = parsed
        rss_parser.extract_podcast_artwork_url.return_value = None
        rss_parser.extract_episodes.return_value = []

        with patch('main_app.feeds._build_and_save_served_rss'):
            feeds_mod.refresh_rss_feed(slug, 'https://example.com/f.xml')

        assert rss_parser.fetch_feed_conditional.call_count == 2
