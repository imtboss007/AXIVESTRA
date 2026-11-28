FROM searxng/searxng:latest
USER root
COPY --chown=searxng:searxng settings.yml /etc/searxng/settings.yml
COPY --chown=searxng:searxng gateway.py /opt/axivestra-search-gateway.py
COPY --chown=searxng:searxng start.sh /opt/axivestra-search-start.sh
RUN chmod 0555 /opt/axivestra-search-start.sh /opt/axivestra-search-gateway.py
USER searxng
ENV GRANIAN_HOST=127.0.0.1
ENV BIND_ADDRESS=127.0.0.1:8080
ENV SEARXNG_PORT=8080
EXPOSE 10000
ENTRYPOINT ["/bin/sh", "/opt/axivestra-search-start.sh"]
